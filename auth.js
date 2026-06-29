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

// Lets a visitor into the app without logging in. requireAuth() checks this flag
// on protected pages so it doesn't bounce them straight back to login.html.
function skipLogin() {
    sessionStorage.setItem('guestMode', 'true');
    window.location.href = 'index.html';
}

// Redirects unauthenticated visitors to the login page. Include on every protected page.
function requireAuth() {
    auth.onAuthStateChanged(user => {
        if (!user && sessionStorage.getItem('guestMode') !== 'true') {
            window.location.href = 'login.html';
        }
    });
}

// Fills in the sidebar avatar circle with the logged-in user's Google photo
// (or a fallback icon for email/password accounts, or guests with no user at all).
function renderSidebarProfile() {
    auth.onAuthStateChanged(user => {
        const avatarImg = document.getElementById('sidebar-avatar');
        const avatarFallback = document.getElementById('sidebar-avatar-fallback');
        const nameLabel = document.getElementById('sidebar-username');
        const loginBtn = document.getElementById('sidebar-login-btn');
        const logoutBtn = document.getElementById('sidebar-logout-btn');
        const navLogoutLink = document.getElementById('nav-logout-link');
        if (!avatarImg || !avatarFallback || !nameLabel || !loginBtn || !logoutBtn) return;

        if (user) {
            nameLabel.textContent = user.displayName || user.email || 'Account';
            loginBtn.style.display = 'none';
            logoutBtn.style.display = 'flex';

            if (user.photoURL) {
                avatarImg.src = user.photoURL;
                avatarImg.style.display = 'block';
                avatarFallback.style.display = 'none';
            } else {
                avatarImg.style.display = 'none';
                avatarFallback.style.display = 'block';
            }

            if (navLogoutLink) {
                navLogoutLink.innerHTML = '<i class="fa-solid fa-right-from-bracket"></i> Log Out';
                navLogoutLink.onclick = logOut;
            }
        } else {
            nameLabel.textContent = 'Account';
            avatarImg.style.display = 'none';
            avatarFallback.style.display = 'block';
            loginBtn.style.display = 'flex';
            logoutBtn.style.display = 'none';

            if (navLogoutLink) {
                navLogoutLink.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Log In';
                navLogoutLink.onclick = function () { window.location.href = 'login.html'; };
            }
        }
    });
}

// Shows/hides the Log In or Log Out button below the sidebar avatar circle.
function toggleProfileMenu() {
    const menu = document.getElementById('sidebar-profile-menu');
    if (!menu) return;
    menu.style.display = menu.style.display === 'none' ? 'flex' : 'none';
}
