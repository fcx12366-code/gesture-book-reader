"""Optional encrypted QA fixture; requires pypdf, never used by the application."""
from pathlib import Path
from pypdf import PdfReader, PdfWriter

target = Path(__file__).resolve().parents[1] / '.test-data'
writer = PdfWriter()
for page in PdfReader(target / 'mixed-12.pdf').pages:
    writer.add_page(page)
writer.encrypt(user_password='zhijian123', owner_password='qa-owner', algorithm='RC4-128')
with (target / 'encrypted.pdf').open('wb') as stream:
    writer.write(stream)
print('Created encrypted.pdf; QA password: zhijian123')
