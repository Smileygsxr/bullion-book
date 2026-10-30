# Programs

Your password-protected area of Bullion Book: **Settings → Programs**, or go
straight to `https://bullion-book.vercel.app/programs/`.

## Adding a program

Put files or folders in this `programs` folder, then commit and push as usual.
After Vercel redeploys they appear in the list on the Programs page:

- **Web pages** (`.html`) open in the browser. A folder with its own
  `index.html` opens that page (e.g. `programs/lot-calculator/index.html`).
- **Anything else** - MT4/MT5 EAs and indicators (`.mq4`, `.mq5`, `.ex4`,
  `.ex5`), scripts, spreadsheets, `.zip` files - downloads when clicked.
- Images, PDFs and text files open in the browser.
- A folder without an `index.html` shows a list of what's inside it.

This README and files starting with `.` don't appear in the list.

## The password

For now it's **1234** - a temporary password until the page opens to the
public (`DEFAULT_PASSWORD` in `api/programs.js`). To use a different one
without changing the code:

1. Vercel → your project → **Settings → Environment Variables**
2. Add `PROGRAMS_PASSWORD` with your password (Production environment)
3. Redeploy (Deployments → ⋯ → Redeploy)

That replaces 1234, and changing it signs everyone out. After entering the
password, a browser stays signed in to Programs for 12 hours (or until
**Log out** on the Programs page).

## Important: who can see these files

The website only serves this folder after the password check
(`api/programs.js`) - but **this GitHub repository is public**, so anyone
browsing the repository on GitHub can read whatever you commit here. Don't
put anything secret in it (API keys, broker logins, a strategy you want to
keep private) unless you make the repository private first
(GitHub → repository → Settings → Danger Zone → Change visibility - Vercel
keeps deploying from a private repository).

Pages in here also run on the same site as your journal, so only add
programs you trust.
