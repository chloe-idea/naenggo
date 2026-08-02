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

  function renderDoc(doc) {
    if (!doc) return '<p class="legal-page__empty">문서를 불러오지 못했어요.</p>';
    const sections = (doc.sections || []).map((section) => {
      const paras = (section.paragraphs || [])
        .map((p) => `<p>${esc(p)}</p>`)
        .join('');
      return `
        <section class="legal-page__section">
          <h2 class="legal-page__heading">${esc(section.heading || '')}</h2>
          ${paras}
        </section>`;
    }).join('');
    return `
      <h1 class="legal-page__title">${esc(doc.title || '')}</h1>
      <p class="legal-page__updated">${esc(doc.updatedLabel || '')}</p>
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
