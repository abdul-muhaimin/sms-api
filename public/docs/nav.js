// SMSaaS Docs — Shared nav builder
function buildNav(activePage) {
  const pages = [
    { href: 'index.html',  label: 'Overview' },
    { href: 'brd.html',    label: 'BRD' },
    { href: 'frd.html',    label: 'FRD' },
    { href: '../api-dashboard.html', label: 'API Console', external: true },
  ];

  // Topbar nav links
  const topbarNav = document.getElementById('topbar-nav');
  if (topbarNav) {
    pages.forEach(p => {
      const a = document.createElement('a');
      a.href = p.href;
      a.textContent = p.label;
      if (p.external) a.target = '_blank';
      if (p.href.includes(activePage)) a.classList.add('active');
      topbarNav.appendChild(a);
    });
  }

  // Sidebar nav
  const sidebarEl = document.getElementById('sidebar-nav');
  if (!sidebarEl) return;

  const sections = {
    'index.html': [
      { label: 'Documents', type: 'section' },
      { href: 'index.html',  label: 'Product Overview',  icon: '📋', page: 'index' },
      { href: 'brd.html',    label: 'Business Requirements', icon: '📊', page: 'brd' },
      { href: 'frd.html',    label: 'Functional Requirements', icon: '⚙️', page: 'frd' },
      { href: '../api-dashboard.html', label: 'API Console', icon: '🔌', external: true },
    ]
  }['index.html'];

  // Build a consistent sidebar for all pages
  const allSections = [
    { type: 'section', label: 'Documents' },
    { type: 'link', href: 'index.html',  label: 'Product Overview',       icon: '📋', page: 'index'  },
    { type: 'link', href: 'brd.html',    label: 'Business Requirements',   icon: '📊', page: 'brd'    },
    { type: 'link', href: 'frd.html',    label: 'Functional Requirements', icon: '⚙️', page: 'frd'    },
    { type: 'section', label: 'Tools' },
    { type: 'link', href: '../api-dashboard.html', label: 'API Console', icon: '🔌', external: true },
  ];

  allSections.forEach(item => {
    if (item.type === 'section') {
      const div = document.createElement('div');
      div.className = 'sidebar-section';
      div.textContent = item.label;
      sidebarEl.appendChild(div);
    } else {
      const a = document.createElement('a');
      a.href = item.href;
      a.className = 'sidebar-item' + (item.page === activePage ? ' active' : '');
      if (item.external) a.target = '_blank';
      a.innerHTML = `<span style="font-size:14px">${item.icon}</span> ${item.label}`;
      sidebarEl.appendChild(a);
    }
  });
}

// Highlight active on-page nav item on scroll
function initOnPageNav() {
  const links = document.querySelectorAll('.on-page-list a');
  if (!links.length) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        links.forEach(l => l.classList.remove('active'));
        const id = entry.target.id;
        const link = document.querySelector(`.on-page-list a[href="#${id}"]`);
        if (link) link.classList.add('active');
      }
    });
  }, { rootMargin: '-10% 0px -80% 0px' });

  document.querySelectorAll('.doc-section[id]').forEach(s => observer.observe(s));
}

document.addEventListener('DOMContentLoaded', initOnPageNav);
