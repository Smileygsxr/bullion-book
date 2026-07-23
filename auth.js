function showAuthError(message) {
    const errorBox = document.getElementById('auth-error');
    if (!errorBox) return;
    errorBox.textContent = message;
    errorBox.style.display = message ? 'block' : 'none';
}

// The app lives at app.html; the root index.html is the public SEO landing
// page. This flag lets the landing page skip itself for people who've logged
// in before (see the head script in index.html) - new visitors and search
// crawlers never have it, so they get the landing page.
function markReturningAppUser() {
    try { localStorage.setItem('bb_app_user', '1'); } catch (e) { /* ignore */ }
}

function loginWithEmail(email, password) {
    showAuthError('');
    return auth.signInWithEmailAndPassword(email, password)
        .then(() => { markReturningAppUser(); window.location.href = 'app.html'; })
        .catch(err => showAuthError(err.message));
}

// Toggles a password field between hidden/visible - btn is the eye button
// sitting inside the same .auth-input-wrap as the <input> it controls.
function togglePasswordVisibility(btn) {
    const wrap = btn.closest('.auth-input-wrap');
    const input = wrap && wrap.querySelector('input');
    if (!input) return;
    const showing = input.type === 'password';
    input.type = showing ? 'text' : 'password';
    const icon = btn.querySelector('i');
    icon.classList.toggle('fa-eye', !showing);
    icon.classList.toggle('fa-eye-slash', showing);
}

// Swaps a submit button into a disabled spinner state while an auth promise
// is in flight, restoring its original label if it resolves with an error
// (a successful login/signup navigates away, so there's nothing to restore).
function withAuthButtonLoading(btn, loadingLabel, promise) {
    if (!btn) return promise;
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner"></i> <span>${loadingLabel}</span>`;
    return promise.finally(() => {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    });
}

function signUpWithEmail(email, password) {
    showAuthError('');
    return auth.createUserWithEmailAndPassword(email, password)
        .then(() => { markReturningAppUser(); window.location.href = 'app.html'; })
        .catch(err => showAuthError(err.message));
}

function loginWithGoogle() {
    showAuthError('');
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider)
        .then(() => { markReturningAppUser(); window.location.href = 'app.html'; })
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
    // Clear the returning-user flag so the landing page shows again - a
    // logged-out visit to the root shouldn't bounce through app.html.
    try { localStorage.removeItem('bb_app_user'); } catch (e) { /* ignore */ }
    auth.signOut().then(() => { window.location.href = 'login.html'; });
}

// Lets a visitor into the app without logging in. requireAuth() checks this flag
// on protected pages so it doesn't bounce them straight back to login.html.
function skipLogin() {
    // Deliberately does NOT set bb_app_user: guest mode is per-tab
    // (sessionStorage), so a returning guest should see the landing page,
    // not get bounced app.html -> login.html in their next session.
    sessionStorage.setItem('guestMode', 'true');
    window.location.href = 'app.html';
}

// Redirects unauthenticated visitors to the login page. Include on every protected page.
function requireAuth() {
    auth.onAuthStateChanged(user => {
        if (!user && sessionStorage.getItem('guestMode') !== 'true') {
            window.location.href = 'login.html';
        } else if (user) {
            markReturningAppUser();
        }
    });
}

// The opposite of requireAuth, for the login/signup pages: someone with a live
// Firebase session shouldn't have to re-enter credentials - forward them
// straight into the app. Also covers existing users' first visit after the
// landing page launch, before bb_app_user has ever been set on their browser.
function redirectIfAuthed() {
    auth.onAuthStateChanged(user => {
        if (user) {
            markReturningAppUser();
            window.location.replace('app.html');
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
        } else {
            nameLabel.textContent = 'Account';
            avatarImg.style.display = 'none';
            avatarFallback.style.display = 'block';
            loginBtn.style.display = 'flex';
            logoutBtn.style.display = 'none';
        }
    });
}

// Shows/hides the Log In or Log Out button below the sidebar avatar circle.
function toggleProfileMenu() {
    const menu = document.getElementById('sidebar-profile-menu');
    if (!menu) return;
    menu.style.display = menu.style.display === 'none' ? 'flex' : 'none';
}

// Subtle cursor-parallax for the login/signup right panel's decorative
// candlestick + gold bar art - each layer drifts by its own data-depth (px)
// so the deeper/closer bar moves more than the further-back candles, a
// cheap fake-3D effect. No-ops anywhere .auth-right-panel doesn't exist.
function initAuthParallax() {
    const panel = document.getElementById('auth-right-panel');
    if (!panel) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const layers = panel.querySelectorAll('.auth-right-art');
    panel.addEventListener('mousemove', event => {
        const rect = panel.getBoundingClientRect();
        const px = (event.clientX - rect.left) / rect.width - 0.5;
        const py = (event.clientY - rect.top) / rect.height - 0.5;
        layers.forEach(layer => {
            const depth = parseFloat(layer.dataset.depth || '10');
            layer.style.translate = `${(px * depth).toFixed(1)}px ${(py * depth).toFixed(1)}px`;
        });
    });

    panel.addEventListener('mouseleave', () => {
        layers.forEach(layer => { layer.style.translate = '0 0'; });
    });
}

document.addEventListener('DOMContentLoaded', initAuthParallax);
