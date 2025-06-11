import re
import uuid
from typing import List, Tuple


class Citation:
    """Represents a single citation with image URL and text."""

    def __init__(self, image_url: str, text: str, citation_id: str = None):
        self.image_url = image_url
        self.text = text
        self.citation_id = citation_id or f"citation_{uuid.uuid4().hex[:8]}"

    def to_html(self) -> str:
        """Convert citation to HTML representation."""
        # Escape quotes in the image URL and text for JavaScript safety
        escaped_url = self.image_url.replace("'", "\\'").replace('"', '\\"')
        escaped_text = self.text.replace("'", "\\'").replace('"', '\\"')

        return f'''
        <span class="citation" onclick="openModal('{escaped_url}', '{escaped_text}')">
            {self.text}
            <div class="citation-tooltip">
                <img src="{self.image_url}" alt="Citation" class="citation-image" onerror="this.style.display='none'; this.nextElementSibling.style.display='block'; this.nextElementSibling.textContent='Image not available: {self.image_url}';">
                <div style="display:none; color:#666; font-size:12px; text-align:center; margin-top:8px;"></div>
            </div>
        </span>
        '''


class CitationParser:
    """Handles parsing and processing of citation tags in text."""

    # Pattern to match <CIT image_url="URL">content</CIT>
    CITATION_PATTERN = r'<CIT\s+image_url="([^"]+)">([^<]+)</CIT>'

    @classmethod
    def extract_citations(cls, text: str) -> List[Citation]:
        """
        Extract all citations from text.

        Args:
            text: Text containing <CIT> tags

        Returns:
            List of Citation objects
        """
        matches = re.finditer(cls.CITATION_PATTERN, text)
        citations = []

        for match in matches:
            image_url = match.group(1).strip()
            # Clean up URL by removing trailing ? or other unwanted characters
            if image_url.endswith("?"):
                image_url = image_url[:-1]
            citation_text = match.group(2).strip()
            citations.append(Citation(image_url, citation_text))

        return citations

    @classmethod
    def has_citations(cls, text: str) -> bool:
        """Check if text contains any citation tags."""
        return "<CIT" in text

    @classmethod
    def process_text(cls, text: str) -> Tuple[str, List[Citation]]:
        """
        Process text and return both processed HTML and extracted citations.

        Args:
            text: Raw text with citation tags

        Returns:
            Tuple of (processed_html, list_of_citations)
        """
        citations = cls.extract_citations(text)
        processed_text = cls._replace_citations_with_html(text)
        return processed_text, citations

    @classmethod
    def _replace_citations_with_html(cls, text: str) -> str:
        """Replace citation tags with interactive HTML."""

        def replace_citation(match):
            image_url = match.group(1).strip()
            # Clean up URL by removing trailing ? or other unwanted characters
            if image_url.endswith("?"):
                image_url = image_url[:-1]
            citation_text = match.group(2).strip()
            citation = Citation(image_url, citation_text)
            return citation.to_html()

        return re.sub(cls.CITATION_PATTERN, replace_citation, text)


class CitationRenderer:
    """Handles rendering of citations in Streamlit."""

    CSS_STYLES = """
    <style>
    /* Message content container with proper font inheritance */
    .message-content {
        font-family: inherit;
        font-size: inherit;
        line-height: inherit;
        color: inherit;
        margin: 0;
        padding: 0;
    }

    /* Citation styling that preserves parent font properties */
    .citation {
        position: relative;
        color: #1f77b4;
        text-decoration: underline;
        cursor: pointer;
        font-weight: inherit;
        font-family: inherit;
        font-size: inherit;
        line-height: inherit;
        display: inline;
        transition: all 0.2s ease;
        /* Ensure citations don't break text flow */
        white-space: inherit;
        word-wrap: inherit;
        overflow-wrap: inherit;
    }

    .citation:hover {
        color: #0066cc;
        background-color: rgba(240, 248, 255, 0.8);
        border-radius: 3px;
        padding: 1px 3px;
        /* Maintain font properties on hover */
        font-weight: inherit;
        font-family: inherit;
        font-size: inherit;
    }

    .citation-tooltip {
        visibility: hidden;
        opacity: 0;
        position: fixed;
        z-index: 1000;
        background-color: white;
        border: 2px solid #ddd;
        border-radius: 8px;
        padding: 10px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        max-width: 400px;
        max-height: 300px;
        transition: opacity 0.3s, visibility 0.3s;
        pointer-events: none;
        transform: translateY(-10px);
        /* Reset font properties for tooltip */
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        font-weight: normal;
        line-height: 1.4;
    }

    .citation:hover .citation-tooltip {
        visibility: visible;
        opacity: 1;
        pointer-events: auto;
        transform: translateY(0);
    }

    .citation-image {
        max-width: 100%;
        max-height: 250px;
        object-fit: contain;
        border-radius: 4px;
        display: block;
    }

    .citation-text {
        margin-top: 8px;
        font-size: 12px;
        color: #666;
        font-style: italic;
        text-align: center;
        font-family: inherit;
    }

    .citation-modal {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0,0,0,0.8);
        z-index: 2000;
        display: none;
        justify-content: center;
        align-items: center;
        backdrop-filter: blur(2px);
        /* Reset font properties for modal */
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    .citation-modal-content {
        background-color: white;
        padding: 20px;
        border-radius: 12px;
        max-width: 90%;
        max-height: 90%;
        overflow: auto;
        position: relative;
        box-shadow: 0 8px 32px rgba(0,0,0,0.3);
        font-family: inherit;
        font-size: 14px;
        line-height: 1.4;
    }

    .citation-modal img {
        max-width: 100%;
        height: auto;
        border-radius: 8px;
    }

    .close-modal {
        position: absolute;
        top: 10px;
        right: 15px;
        font-size: 28px;
        cursor: pointer;
        color: #666;
        background: white;
        border-radius: 50%;
        width: 35px;
        height: 35px;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        transition: all 0.2s ease;
        font-family: inherit;
    }

    .close-modal:hover {
        color: #000;
        background: #f0f0f0;
        transform: scale(1.1);
    }

    .citation-count {
        display: inline-block;
        background: #1f77b4;
        color: white;
        border-radius: 10px;
        padding: 2px 6px;
        font-size: 10px;
        margin-left: 4px;
        vertical-align: super;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-weight: 500;
        line-height: 1.2;
    }

    /* Ensure proper text rendering and spacing */
    .message-content p {
        margin: 0 0 1em 0;
        font-family: inherit;
        font-size: inherit;
        font-weight: inherit;
        line-height: inherit;
    }

    .message-content p:last-child {
        margin-bottom: 0;
    }

    /* Handle different text elements within citations */
    .citation strong {
        font-weight: bold;
        font-family: inherit;
        font-size: inherit;
    }

    .citation em {
        font-style: italic;
        font-family: inherit;
        font-size: inherit;
    }

    .citation code {
        font-family: 'SFMono-Regular', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
        font-size: 0.9em;
        background-color: rgba(175, 184, 193, 0.2);
        padding: 0.2em 0.4em;
        border-radius: 3px;
    }
    </style>
    """

    JAVASCRIPT = """
    <script>
    function openModal(imageUrl, altText) {
        console.log('Opening modal with URL:', imageUrl); // Debug logging
        const modal = document.getElementById('citation-modal');
        const modalImg = document.getElementById('modal-image');
        const modalText = document.getElementById('modal-text');
        
        if (modal && modalImg && modalText) {
            modal.style.display = 'flex';
            modalImg.src = imageUrl;
            modalImg.onerror = function() {
                console.error('Failed to load image:', imageUrl); // Debug logging
                this.style.display = 'none';
                modalText.textContent = 'Image could not be loaded: ' + imageUrl;
                modalText.style.color = '#e74c3c';
            };
            modalImg.onload = function() {
                console.log('Image loaded successfully:', imageUrl); // Debug logging
                modalText.textContent = altText || 'Citation Image';
                modalText.style.color = '#333';
            };
        }
    }

    function closeModal() {
        const modal = document.getElementById('citation-modal');
        if (modal) {
            modal.style.display = 'none';
        }
    }

    // Initialize event listeners when DOM is ready
    document.addEventListener('DOMContentLoaded', function() {
        // Close modal when clicking outside the content
        window.onclick = function(event) {
            const modal = document.getElementById('citation-modal');
            if (event.target === modal) {
                closeModal();
            }
        }

        // Close modal with Escape key
        document.addEventListener('keydown', function(event) {
            if (event.key === 'Escape') {
                closeModal();
            }
        });
    });
    </script>
    """

    @classmethod
    def get_modal_html(cls) -> str:
        """Get the HTML for the citation modal."""
        return """
        <div id="citation-modal" class="citation-modal">
            <div class="citation-modal-content">
                <span class="close-modal" onclick="closeModal()">&times;</span>
                <img id="modal-image" src="" alt="Citation Image">
                <p id="modal-text"></p>
            </div>
        </div>
        """

    @classmethod
    def get_full_html_template(cls, content: str, citation_count: int = 0) -> str:
        """
        Get complete HTML template with styles, scripts, and content.

        Args:
            content: Processed content with citations
            citation_count: Number of citations in the content

        Returns:
            Complete HTML string
        """
        citation_badge = (
            f'<span class="citation-count">{citation_count}</span>'
            if citation_count > 0
            else ""
        )

        return f"""
        {cls.CSS_STYLES}
        {cls.JAVASCRIPT}
        {cls.get_modal_html()}
        <div class="message-content">
            {content}
            {citation_badge}
        </div>
        """
