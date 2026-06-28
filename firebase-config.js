// 1. Go to https://console.firebase.google.com -> "Add project" -> name it (e.g. "Bullion Book") -> create.
// 2. In the project, go to Build > Authentication > Get Started.
//    - Sign-in method tab: enable "Email/Password" and enable "Google".
// 3. Go to Project settings (gear icon) > General > "Your apps" > click the Web icon (</>) to register a web app.
// 4. Firebase will show you a firebaseConfig object - copy its values into the object below.
// 5. Back in Authentication > Settings > Authorized domains: add "localhost" (already there) and
//    whatever domain you eventually host this on.
//
// These values are safe to ship in client-side code - they identify your project, they are not secrets.
// Access control is enforced by Firebase's own rules/auth, not by hiding this file.

const firebaseConfig = {
    apiKey: "AIzaSyCJxFFv6RYgb5NIzGzsH1QdtqHbIYTBwYE",
    authDomain: "bullion-book.firebaseapp.com",
    projectId: "bullion-book",
    storageBucket: "bullion-book.firebasestorage.app",
    messagingSenderId: "783703507401",
    appId: "1:783703507401:web:29d2c9d975debccf812818",
    measurementId: "G-51T6H6YE9B"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
