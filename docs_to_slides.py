"""AI writing and accuracy assistant for Google Docs.

This script reads a Google Doc, analyzes text with an AI model, inserts
suggestions as comments, applies formatting, and optionally creates a
Google Slides presentation.
"""

from __future__ import annotations

import argparse
import json
import os
import re
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Tuple

import requests
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

# OAuth scopes for Docs, Slides, and Drive comments.
SCOPES = [
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/presentations",
]

# Writing modes supported by the assistant.
WRITING_MODES = {"essay", "email", "presentation", "creative"}


@dataclass
class ParagraphBlock:
    """Represents a paragraph extracted from a Google Doc."""

    text: str
    start_index: int
    end_index: int
    is_heading: bool
    heading_level: Optional[str]


@dataclass
class Suggestion:
    """Represents an AI suggestion for a sentence."""

    category: str
    sentence: str
    suggestion: str
    needs_citation: bool


@dataclass
class AnalysisResult:
    """Holds suggestions for a paragraph and any summary."""

    suggestions: List[Suggestion]
    summary: Optional[str]


class AIClient:
    """Minimal client for invoking an AI model for text analysis."""

    def __init__(self, api_key: str, model: str) -> None:
        self.api_key = api_key
        self.model = model

    def analyze_paragraph(self, paragraph: str, mode: str) -> AnalysisResult:
        """Send a paragraph to the AI model and parse suggestions."""
        prompt = (
            "You are an AI writing assistant. Analyze the paragraph for grammar, "
            "clarity, tone, and factual accuracy. Return JSON with keys: "
            "suggestions (list of {category, sentence, suggestion, needs_citation}) "
            "and summary (optional). Use the writing mode: "
            f"{mode}. Paragraph: {paragraph!r}"
        )

        response = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": self.model,
                "messages": [
                    {"role": "system", "content": "Respond with JSON only."},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.2,
            },
            timeout=60,
        )
        response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"]
        data = json.loads(content)

        suggestions = [
            Suggestion(
                category=item["category"],
                sentence=item["sentence"],
                suggestion=item["suggestion"],
                needs_citation=item.get("needs_citation", False),
            )
            for item in data.get("suggestions", [])
        ]
        summary = data.get("summary")
        return AnalysisResult(suggestions=suggestions, summary=summary)


def get_credentials() -> Credentials:
    """Load or request OAuth2 credentials for Google APIs."""
    creds = None
    if os.path.exists("token.json"):
        creds = Credentials.from_authorized_user_file("token.json", SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(
                "credentials.json", SCOPES
            )
            creds = flow.run_local_server(port=0)
        with open("token.json", "w", encoding="utf-8") as token:
            token.write(creds.to_json())

    return creds


def extract_paragraphs(document: Dict) -> List[ParagraphBlock]:
    """Extract paragraphs and headings with their ranges from a Doc."""
    blocks: List[ParagraphBlock] = []

    for element in document.get("body", {}).get("content", []):
        paragraph = element.get("paragraph")
        if not paragraph:
            continue

        text_runs = paragraph.get("elements", [])
        text = "".join(
            run.get("textRun", {}).get("content", "") for run in text_runs
        ).strip()
        if not text:
            continue

        style = paragraph.get("paragraphStyle", {})
        named_style = style.get("namedStyleType", "NORMAL_TEXT")

        start_index = element.get("startIndex", 0)
        end_index = element.get("endIndex", start_index)

        blocks.append(
            ParagraphBlock(
                text=text,
                start_index=start_index,
                end_index=end_index,
                is_heading=named_style.startswith("HEADING"),
                heading_level=named_style if named_style.startswith("HEADING") else None,
            )
        )

    return blocks


def split_sentences(text: str) -> List[str]:
    """Basic sentence splitter for comment placement."""
    return [sentence.strip() for sentence in re.split(r"(?<=[.!?])\s+", text) if sentence]


def add_comment(drive_service, file_id: str, content: str) -> None:
    """Insert a comment into the Doc to suggest a rewrite."""
    drive_service.comments().create(
        fileId=file_id,
        body={"content": content},
    ).execute()


def highlight_text(docs_service, document_id: str, start: int, end: int) -> None:
    """Highlight text that may need citations or is factually uncertain."""
    requests_payload = [
        {
            "updateTextStyle": {
                "range": {"startIndex": start, "endIndex": end},
                "textStyle": {
                    "backgroundColor": {
                        "color": {"rgbColor": {"red": 1.0, "green": 0.9, "blue": 0.6}}
                    }
                },
                "fields": "backgroundColor",
            }
        }
    ]
    docs_service.documents().batchUpdate(
        documentId=document_id, body={"requests": requests_payload}
    ).execute()


def apply_formatting(
    docs_service,
    document_id: str,
    blocks: Iterable[ParagraphBlock],
    mode: str,
) -> None:
    """Apply font and paragraph formatting based on content type."""
    font_map = {
        "essay": "Times New Roman",
        "email": "Arial",
        "presentation": "Montserrat",
        "creative": "Georgia",
    }
    font_family = font_map.get(mode, "Arial")

    requests_payload = []
    for block in blocks:
        text_style = {
            "fontSize": {"magnitude": 14 if block.is_heading else 11, "unit": "PT"},
            "weightedFontFamily": {"fontFamily": font_family},
            "bold": block.is_heading,
        }
        requests_payload.append(
            {
                "updateTextStyle": {
                    "range": {
                        "startIndex": block.start_index,
                        "endIndex": block.end_index,
                    },
                    "textStyle": text_style,
                    "fields": "fontSize,weightedFontFamily,bold",
                }
            }
        )

    if requests_payload:
        docs_service.documents().batchUpdate(
            documentId=document_id, body={"requests": requests_payload}
        ).execute()


def insert_summary(docs_service, document_id: str, summary: str) -> None:
    """Insert a summary at the top of the document."""
    requests_payload = [
        {"insertText": {"location": {"index": 1}, "text": f"Summary\n{summary}\n\n"}},
        {
            "updateParagraphStyle": {
                "range": {"startIndex": 1, "endIndex": len("Summary") + 1},
                "paragraphStyle": {"namedStyleType": "HEADING_1"},
                "fields": "namedStyleType",
            }
        },
    ]
    docs_service.documents().batchUpdate(
        documentId=document_id, body={"requests": requests_payload}
    ).execute()


def collect_headings_and_points(blocks: Iterable[ParagraphBlock]) -> List[Tuple[str, List[str]]]:
    """Build heading sections for slides or structured output."""
    sections: List[Tuple[str, List[str]]] = []
    current_heading = "Untitled Section"
    current_points: List[str] = []

    for block in blocks:
        if block.is_heading:
            if current_heading or current_points:
                sections.append((current_heading, current_points))
            current_heading = block.text
            current_points = []
        else:
            current_points.append(block.text)

    if current_heading or current_points:
        sections.append((current_heading, current_points))

    return [
        (heading, points)
        for heading, points in sections
        if heading.strip() or any(point.strip() for point in points)
    ]


def create_slides_presentation(
    slides_service, title: str, sections: List[Tuple[str, List[str]]]
) -> str:
    """Create a Google Slides presentation for presentation mode."""
    presentation = slides_service.presentations().create(body={"title": title}).execute()
    presentation_id = presentation.get("presentationId")

    requests_payload = []
    for index, (heading, points) in enumerate(sections, start=1):
        slide_id = f"slide_{index}"
        title_id = f"title_{index}"
        body_id = f"body_{index}"

        requests_payload.append(
            {
                "createSlide": {
                    "objectId": slide_id,
                    "insertionIndex": index,
                    "slideLayoutReference": {"predefinedLayout": "TITLE_AND_BODY"},
                    "placeholderIdMappings": [
                        {"layoutPlaceholder": {"type": "TITLE"}, "objectId": title_id},
                        {"layoutPlaceholder": {"type": "BODY"}, "objectId": body_id},
                    ],
                }
            }
        )

        requests_payload.append(
            {"insertText": {"objectId": title_id, "text": heading}}
        )

        bullet_text = "\n".join(points) if points else ""
        requests_payload.append(
            {"insertText": {"objectId": body_id, "text": bullet_text}}
        )
        if points:
            requests_payload.append(
                {
                    "createParagraphBullets": {
                        "objectId": body_id,
                        "textRange": {"type": "ALL"},
                        "bulletPreset": "BULLET_DISC_CIRCLE_SQUARE",
                    }
                }
            )

    if requests_payload:
        slides_service.presentations().batchUpdate(
            presentationId=presentation_id, body={"requests": requests_payload}
        ).execute()

    return presentation_id


def analyze_and_comment(
    document_id: str,
    blocks: List[ParagraphBlock],
    mode: str,
    ai_client: AIClient,
    docs_service,
    drive_service,
    generate_summary: bool,
) -> None:
    """Analyze paragraphs with AI, insert comments, and highlight issues."""
    summaries: List[str] = []

    for block in blocks:
        result = ai_client.analyze_paragraph(block.text, mode)

        if generate_summary and result.summary:
            summaries.append(result.summary)

        for suggestion in result.suggestions:
            comment_body = (
                f"Category: {suggestion.category}\n"
                f"Sentence: {suggestion.sentence}\n"
                f"Suggestion: {suggestion.suggestion}"
            )
            add_comment(drive_service, document_id, comment_body)

            if suggestion.needs_citation:
                # Highlight the entire paragraph as a conservative range.
                highlight_text(docs_service, document_id, block.start_index, block.end_index)

    if generate_summary and summaries:
        summary_text = " ".join(summaries)
        insert_summary(docs_service, document_id, summary_text)


def parse_args() -> argparse.Namespace:
    """Parse CLI arguments for the assistant."""
    parser = argparse.ArgumentParser(description="AI writing assistant for Google Docs")
    parser.add_argument("--document-id", required=True, help="Google Doc document ID")
    parser.add_argument(
        "--mode",
        default="essay",
        choices=sorted(WRITING_MODES),
        help="Writing mode for analysis and formatting",
    )
    parser.add_argument(
        "--summary",
        action="store_true",
        help="Generate a summary and insert it at the top of the Doc",
    )
    return parser.parse_args()


def main() -> None:
    """Run the AI writing and accuracy assistant."""
    args = parse_args()

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise SystemExit("Set OPENAI_API_KEY to use the AI analysis.")

    ai_model = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
    ai_client = AIClient(api_key=api_key, model=ai_model)

    creds = get_credentials()

    docs_service = build("docs", "v1", credentials=creds)
    slides_service = build("slides", "v1", credentials=creds)
    drive_service = build("drive", "v3", credentials=creds)

    document = docs_service.documents().get(documentId=args.document_id).execute()
    blocks = extract_paragraphs(document)

    analyze_and_comment(
        document_id=args.document_id,
        blocks=blocks,
        mode=args.mode,
        ai_client=ai_client,
        docs_service=docs_service,
        drive_service=drive_service,
        generate_summary=args.summary,
    )

    apply_formatting(docs_service, args.document_id, blocks, args.mode)

    if args.mode == "presentation":
        sections = collect_headings_and_points(blocks)
        presentation_id = create_slides_presentation(
            slides_service, document.get("title", "Presentation"), sections
        )
        print(
            "Created Slides presentation: "
            f"https://docs.google.com/presentation/d/{presentation_id}"
        )


if __name__ == "__main__":
    main()
