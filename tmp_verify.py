from backend.agents.data_extractor_agent import extract_documents
from pathlib import Path
import json

docs = extract_documents([Path(r"C:\Users\jotav\OneDrive\I2A2 QUANTUM\202505_NFe.zip")])
for doc in docs:
    print("--", doc.name, doc.status)
    print(json.dumps(doc.meta.get("column_mapping"), ensure_ascii=False, indent=2))
    first = (doc.data or [None])[0]
    if first:
        print(json.dumps(first, ensure_ascii=False, indent=2))
