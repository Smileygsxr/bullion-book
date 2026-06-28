function showAuthError(message) {
    const errorBox = document.getElementById('auth-error');
    if (!errorBox) return;
    errorBox.textContent = message;
    errorBox.style.display = message ? 'block' : 'none';
}

function loginWithEmail(email, password) {
    showAuthError('');
    auth.signInWithEmailAndPassword(email, password)
        .then(() => { window.location.href = 'index.html'; })
        .catch(err => showAuthError(err.message));
}

function signUpWithEmail(email, password) {
    showAuthError('');
    auth.createUserWithEmailAndPassword(email, password)
        .then(() => { window.location.href = 'index.html'; })
        .catch(err => showAuthError(err.message));
}

function loginWithGoogle() {
    showAuthError('');
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider)
        .then(() => { window.location.href = 'index.html'; })
        .catch(err => showAuthError(err.message));
}

function sendPasswordReset(email) {
    showAuthError('');
    if (!email) {
        showAuthError('Enter your email above first, then click "Forgot password?"');
        return;
    }
    auth.sendPasswordResetEmail(email)
        .then(() => showAuthError('Password reset email sent.'))
        .catch(err => showAuthError(err.message));
}

function logOut() {
    auth.signOut().then(() => { window.location.href = 'login.html'; });
}

// Redirects unauthenticated visitors to the login page. Include on every protected page.
function requireAuth() {
    auth.onAuthStateChanged(user => {
        if (!user) window.location.href = 'login.html';
    });
}
