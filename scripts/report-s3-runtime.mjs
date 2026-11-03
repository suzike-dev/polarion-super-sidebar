import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
const db=new DatabaseSync(path.join(process.env.LOCALAPPDATA,'Nanju/PolarionSidebar/state.sqlite'),{readOnly:true});
const row=db.prepare("SELECT data FROM events WHERE kind='engine' ORDER BY seq DESC LIMIT 1").get();
console.log(JSON.stringify(row?JSON.parse(row.data):null));db.close();
