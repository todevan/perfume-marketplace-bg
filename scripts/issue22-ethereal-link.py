import email
import imaplib
import os
import re
import sys
import time
from html import unescape
from urllib.parse import parse_qs, urlparse


def required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"missing required environment variable: {name}")
    return value


user = required("ETHEREAL_USER")
password = required("ETHEREAL_PASS")
recipient = required("ISSUE22_RECIPIENT")
expected_origin = required("ISSUE22_HOSTED_ORIGIN").rstrip("/")
parsed_origin = urlparse(expected_origin)
if parsed_origin.scheme != "https" or not parsed_origin.netloc or parsed_origin.path:
    raise RuntimeError("ISSUE22_HOSTED_ORIGIN must be an HTTPS origin")

deadline = time.time() + 120
while time.time() < deadline:
    with imaplib.IMAP4_SSL("imap.ethereal.email", 993) as mailbox:
        mailbox.login(user, password)
        for folder in ("INBOX", "Sent", "Sent Messages"):
            try:
                if mailbox.select(f'"{folder}"', readonly=True)[0] != "OK":
                    continue
                status, ids = mailbox.search(None, "ALL")
                if status != "OK":
                    continue
                for item in reversed(ids[0].split()[-50:]):
                    status, data = mailbox.fetch(item, "(RFC822)")
                    if status != "OK" or not data or not isinstance(data[0], tuple):
                        continue
                    message = email.message_from_bytes(data[0][1])
                    if recipient.lower() not in str(message.get("To", "")).lower():
                        continue
                    parts = []
                    for part in message.walk() if message.is_multipart() else (message,):
                        if part.get_content_type() in ("text/html", "text/plain"):
                            payload = part.get_payload(decode=True) or b""
                            parts.append(payload.decode(part.get_content_charset() or "utf-8", "replace"))
                    body = unescape("\n".join(parts))
                    for candidate in re.findall(r"https://[^\s\"<>]+/auth/confirm\?[^\s\"<>]+", body):
                        link = candidate.rstrip(".,)")
                        parsed = urlparse(link)
                        query = parse_qs(parsed.query)
                        if f"{parsed.scheme}://{parsed.netloc}" != expected_origin:
                            continue
                        if parsed.path != "/auth/confirm" or query.get("type") != ["email"]:
                            continue
                        if not query.get("token_hash"):
                            continue
                        sys.stdout.write(link)
                        sys.exit(0)
            except imaplib.IMAP4.error:
                continue
    time.sleep(2)

raise TimeoutError("confirmation email was not captured")
