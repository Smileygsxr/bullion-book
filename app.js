function switchNewsTab(tabId, clickedButton) {
    // 1. Find and hide all nested news feed subsections
    const subPages = document.querySelectorAll('.news-sub-page');
    subPages.forEach(page => {
        page.style.display = 'none';
    });

    // 2. Open up the specifically selected index tab area
    const activeTab = document.getElementById(tabId);
    if (activeTab) {
        activeTab.style.display = 'block';
    }

    // 3. Cycle active visual indicator highlights on header pills
    const newsButtons = document.querySelectorAll('.news-tab');
    newsButtons.forEach(btn => {
        btn.classList.remove('active');
    });
    
    if (clickedButton) {
        clickedButton.classList.add('active');
    }
}

// ADD THIS FUNCTION TO THE BOTTOM OF YOUR FILE
function showPage(pageId, clickedElement) {
    // 1. Hide every main view container block out of sight
    const views = document.querySelectorAll('.view-section');
    views.forEach(view => {
        view.style.display = 'none';
    });

    // 2. Display the selected targeted main view panel
    const targetView = document.getElementById(pageId);
    if (targetView) {
        targetView.style.display = 'flex';
    }

    // 3. Cycle active highlights across the main sidebar links
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
        link.classList.remove('active');
    });

    // 4. Highlight the correct active sidebar item
    if (clickedElement && clickedElement.classList.contains('nav-link')) {
        clickedElement.classList.add('active');
    } else {
        // Fallback default: light up dashboard if logo branding text is chosen
        const dashLink = document.querySelector('.nav-link[onclick*="page-dashboard"]');
        if (dashLink) {
            dashLink.classList.add('active');
        }
    }
}



