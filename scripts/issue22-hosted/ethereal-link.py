import email, imaplib, os, re, sys, time
from html import unescape
from urllib.parse import urlparse, parse_qs

user=os.environ['ETHEREAL_USER']; password=os.environ['ETHEREAL_PASS']; recipient=os.environ['ISSUE22_RECIPIENT']
deadline=time.time()+90
while time.time()<deadline:
  with imaplib.IMAP4_SSL('imap.ethereal.email',993) as mailbox:
    mailbox.login(user,password)
    for folder in ('INBOX','Sent','Sent Messages'):
      try:
        if mailbox.select(f'"{folder}"',readonly=True)[0] != 'OK': continue
        status, ids=mailbox.search(None,'ALL')
        if status!='OK': continue
        for item in reversed(ids[0].split()[-30:]):
          status,data=mailbox.fetch(item,'(RFC822)')
          if status!='OK' or not data or not isinstance(data[0],tuple): continue
          msg=email.message_from_bytes(data[0][1])
          if recipient.lower() not in str(msg.get('To','')).lower(): continue
          parts=[]
          for part in msg.walk() if msg.is_multipart() else (msg,):
            if part.get_content_type() in ('text/html','text/plain'):
              payload=part.get_payload(decode=True) or b''
              parts.append(payload.decode(part.get_content_charset() or 'utf-8','replace'))
          match=re.search(r'https://perfume-marketplace-bg-issue22\.perfume-marketplace-bg\.workers\.dev/auth/confirm\?[^\s"<>]+',unescape('\n'.join(parts)))
          if not match: continue
          link=match.group(0).rstrip(').,')
          parsed=urlparse(link); query=parse_qs(parsed.query)
          if parsed.scheme!='https' or parsed.netloc!='perfume-marketplace-bg-issue22.perfume-marketplace-bg.workers.dev' or query.get('type')!=['email'] or not query.get('token_hash'): raise RuntimeError('unsafe confirmation link shape')
          sys.stdout.write(link); sys.exit(0)
      except imaplib.IMAP4.error:
        continue
  time.sleep(2)
raise TimeoutError('confirmation email was not captured')
