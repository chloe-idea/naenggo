/**
 * 법률 문서 페이지 렌더러 — Firebase/Auth 미사용, 비로그인 접근용
 */
(function initLegalPage() {
  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderParagraphs(paragraphs) {
    return (paragraphs || [])
      .map((p) => `<p>${esc(p)}</p>`)
      .join('');
  }

  function renderList(items) {
    if (!Array.isArray(items) || !items.length) return '';
    const lis = items.map((item) => `<li>${esc(item)}</li>`).join('');
    return `<ul class="legal-page__list">${lis}</ul>`;
  }

  function renderSubSections(subSections) {
    return (subSections || []).map((sub) => `
      <div class="legal-page__sub">
        <h3 class="legal-page__subheading">${esc(sub.heading || '')}</h3>
        ${renderParagraphs(sub.paragraphs)}
        ${renderList(sub.list)}
      </div>
    `).join('');
  }

  function renderDoc(doc) {
    if (!doc) return '<p class="legal-page__empty">문서를 불러오지 못했어요.</p>';
    const intro = renderParagraphs(doc.intro);
    const sections = (doc.sections || []).map((section) => `
      <section class="legal-page__section">
        <h2 class="legal-page__heading">${esc(section.heading || '')}</h2>
        ${renderParagraphs(section.paragraphs)}
        ${renderSubSections(section.subSections)}
        ${renderList(section.list)}
        ${renderParagraphs(section.closing)}
      </section>
    `).join('');
    return `
      <h1 class="legal-page__title">${esc(doc.title || '')}</h1>
      <p class="legal-page__updated">${esc(doc.updatedLabel || '')}</p>
      <div class="legal-page__intro">${intro}</div>
      ${sections}`;
  }

  function bindBack() {
    const back = document.getElementById('legal-back-btn');
    if (!back) return;
    back.addEventListener('click', (e) => {
      e.preventDefault();
      if (window.history.length > 1) {
        window.history.back();
        return;
      }
      window.location.href = '/';
    });
  }

  function boot() {
    const root = document.getElementById('legal-content');
    const docKey = document.body?.dataset?.legalDoc;
    const doc = docKey === 'terms'
      ? window.LEGAL_TERMS
      : window.LEGAL_PRIVACY;
    if (root) root.innerHTML = renderDoc(doc);
    if (doc?.title) document.title = `${doc.title} - 냉장GO`;
    bindBack();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
