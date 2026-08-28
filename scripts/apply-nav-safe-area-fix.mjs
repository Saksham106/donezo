import { readFile, writeFile } from 'node:fs/promises';

const cssPath = 'styles.css';
const appPath = 'src/app.js';
let css = await readFile(cssPath, 'utf8');
let app = await readFile(appPath, 'utf8');

if (!css.includes('--app-safe-bottom:')) {
  css = css.replace(
    '*{box-sizing:border-box}',
    ':root{--app-safe-bottom:clamp(.25rem,env(safe-area-inset-bottom),1.5rem)}\n*{box-sizing:border-box}',
  );
}

css = css.replace(
  'padding:.18rem var(--space-2) calc(.1rem + env(safe-area-inset-bottom))',
  'padding:.08rem var(--space-2) var(--app-safe-bottom)',
);
css = css.replace('min-height:2.8rem', 'min-height:2.65rem');
css = css.replace('margin-top:-.25rem', 'margin-top:0');
css = css.replace(
  'bottom:calc(4.65rem + env(safe-area-inset-bottom))',
  'bottom:calc(4.15rem + var(--app-safe-bottom))',
);

if (!app.includes('userPlus:')) {
  app = app.replace(
    `    user: '<circle cx="12" cy="8" r="3.5"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/>',`,
    `    user: '<circle cx="12" cy="8" r="3.5"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/>',\n    userPlus: '<circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M19 8v6"/><path d="M16 11h6"/>',`,
  );
}
app = app.replace(
  `data-invite-open aria-label="Invite friends" title="Invite friends">\${icon('share')}</button>`,
  `data-invite-open aria-label="Invite friends" title="Invite friends">\${icon('userPlus')}</button>`,
);

await writeFile(cssPath, css);
await writeFile(appPath, app);
