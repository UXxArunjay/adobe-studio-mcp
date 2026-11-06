// Manual check for the popup watchdog: node scripts/test-dialogs.mjs [list|press] [button]
import { listDialogs, pressDialog } from '../dist/transport/dialogs.js';
const [action = 'list', button = 'OK'] = process.argv.slice(2);
const ds = await listDialogs();
console.log(JSON.stringify(ds, null, 1));
if (action === 'press' && ds[0]) console.log(JSON.stringify(await pressDialog(ds[0].hwnd, button)));
