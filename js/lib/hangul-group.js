/**
 * 한글 초성 그룹 · 가나다순 정렬 (재료 목록 등)
 */
(function initHangulGroup(global) {
  const CHOSEONG = [
    'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ',
    'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
  ];

  /** 쌍자음은 기본 초성 그룹으로 합침 */
  const CHOSEONG_TO_GROUP = {
    ㄱ: 'ㄱ', ㄲ: 'ㄱ',
    ㄴ: 'ㄴ',
    ㄷ: 'ㄷ', ㄸ: 'ㄷ',
    ㄹ: 'ㄹ',
    ㅁ: 'ㅁ',
    ㅂ: 'ㅂ', ㅃ: 'ㅂ',
    ㅅ: 'ㅅ', ㅆ: 'ㅅ',
    ㅇ: 'ㅇ',
    ㅈ: 'ㅈ', ㅉ: 'ㅈ',
    ㅊ: 'ㅊ', ㅋ: 'ㅋ', ㅌ: 'ㅌ', ㅍ: 'ㅍ', ㅎ: 'ㅎ',
  };

  const GROUP_ORDER = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ', '기타'];
  const OTHER_GROUP = '기타';

  function firstMeaningfulChar(name) {
    const text = String(name || '').trim();
    if (!text) return '';
    // 이모지/기호 건너뛰고 첫 글자
    for (const ch of text) {
      if (/\s/.test(ch)) continue;
      return ch;
    }
    return text.charAt(0);
  }

  /** 이름 → 초성 그룹 키 (ㄱ~ㅎ 또는 기타) */
  function getHangulInitialGroup(name) {
    const ch = firstMeaningfulChar(name);
    if (!ch) return OTHER_GROUP;

    const code = ch.charCodeAt(0);

    // 완성형 한글 음절
    if (code >= 0xAC00 && code <= 0xD7A3) {
      const choseong = CHOSEONG[Math.floor((code - 0xAC00) / 588)];
      return CHOSEONG_TO_GROUP[choseong] || OTHER_GROUP;
    }

    // 이미 초성 자모인 경우
    if (CHOSEONG_TO_GROUP[ch]) return CHOSEONG_TO_GROUP[ch];

    return OTHER_GROUP;
  }

  function compareKoNames(a, b) {
    return String(a || '').localeCompare(String(b || ''), 'ko', {
      sensitivity: 'base',
      numeric: true,
    });
  }

  /**
   * @param {Array<{ name?: string }>} items
   * @param {{ query?: string, getName?: (item) => string }} [options]
   * @returns {{ group: string, items: object[] }[]}
   */
  function groupItemsByHangulInitial(items, options = {}) {
    const getName = typeof options.getName === 'function'
      ? options.getName
      : (item) => item?.name || '';
    const query = String(options.query || '').trim().toLocaleLowerCase();

    const filtered = (Array.isArray(items) ? items : []).filter((item) => {
      if (!query) return true;
      return String(getName(item)).toLocaleLowerCase().includes(query);
    });

    const buckets = new Map();
    GROUP_ORDER.forEach((key) => buckets.set(key, []));

    filtered.forEach((item) => {
      const group = getHangulInitialGroup(getName(item));
      const list = buckets.get(group) || buckets.get(OTHER_GROUP);
      list.push(item);
    });

    buckets.forEach((list) => {
      list.sort((a, b) => compareKoNames(getName(a), getName(b)));
    });

    return GROUP_ORDER
      .filter((group) => (buckets.get(group) || []).length > 0)
      .map((group) => ({ group, items: buckets.get(group) }));
  }

  global.HangulGroup = {
    GROUP_ORDER,
    OTHER_GROUP,
    getHangulInitialGroup,
    compareKoNames,
    groupItemsByHangulInitial,
  };
})(typeof window !== 'undefined' ? window : globalThis);
