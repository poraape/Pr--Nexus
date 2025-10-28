import pandas as pd
import json
import zipfile
zip_path = r"C:\Users\jotav\OneDrive\I2A2 QUANTUM\202505_NFe.zip"
with zipfile.ZipFile(zip_path) as z:
    names = z.namelist()
    print('FILES', json.dumps(names, ensure_ascii=False))
    for name in names:
        with z.open(name) as f:
            df = pd.read_csv(f, sep=';', encoding='latin-1', quotechar='"', decimal=',')
            print('FILE', name)
            print(json.dumps(df.columns.tolist(), ensure_ascii=False))
            print(df.head(1).to_json(orient='records', force_ascii=False))
