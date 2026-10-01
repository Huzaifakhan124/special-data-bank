# Special Branch Data Bank

Files: index.html (the app), firestore.rules (database security rules).

1. Firebase Console > Firestore Database > Rules: paste firestore.rules > Publish.
2. Upload index.html to a GitHub repo, import the repo in Vercel (no build settings needed).
3. Firebase Console > Authentication > Settings > Authorized domains: add your Vercel domain.
4. Open the app and create the admin account with specialbranchh007@gmail.com FIRST,
   then verify the email from the link Firebase sends.

Change admin email: edit ADMIN in index.html and the email in firestore.rules, then re-publish the rules.
