/**
 * 재료명 → 이모지 매칭 유틸
 * 1) 정확히 일치하는 키워드
 * 2) 긴 키워드 우선 부분 일치
 * 3) 카테고리 기본 아이콘
 */
(function () {
  const DEFAULT_EMOJI = '🥬';

  /** 이름 완전 일치 */
  const EXACT_EMOJI = {
    계란: '🥚', 달걀: '🥚',
    우유: '🥛',
    쌀: '🍚', 밥: '🍚',
    김치: '🥬',
    소금: '🧂', 설탕: '🧂',
    간장: '🫙', 된장: '🫙', 고추장: '🫙',
    버터: '🧈', 치즈: '🧀',
    두부: '🫘',
    사과: '🍎', 바나나: '🍌', 레몬: '🍋',
    양파: '🧅', 마늘: '🧄', 대파: '🧅', 파: '🧅', 쪽파: '🧅',
    토마토: '🍅', 감자: '🥔', 당근: '🥕',
    상추: '🥬', 양배추: '🥬', 브로콜리: '🥦', 버섯: '🍄', 고추: '🌶️',
    베이컨: '🥓', 닭고기: '🍗', 돼지고기: '🥩', 소고기: '🥩',
    새우: '🦐', 연어: '🐟', 참치: '🐟',
    면: '🍜', 라면: '🍜', 파스타: '🍝', 빵: '🍞',
    식용유: '🫒',
  };

  /**
   * 부분 일치 규칙 — 긴 키워드가 먼저 검사되도록 정렬해 등록
   * @type {{ emoji: string, keywords: string[] }[]}
   */
  const KEYWORD_RULES = [
    // 소스·장류 (소금/설탕보다 먼저)
    { emoji: '🫙', keywords: [
      '양조간장', '국간장', '진간장', '간장', '된장', '고추장', '쌈장', '초고추장', '춘장', '짜장',
      '멸치액젓', '새우젓', '어간장', '액젓', '굴소스', '오이소스', '스테이크소스', '데리야끼', '소스',
      '케첩', '마요네즈', '머스터드', '식초', '발사믹', '올리브오일', '참기름', '들기름', '식용유', '포도씨유',
      '꿀', '시럽', '물엿', '올리고당',
    ] },
    // 조미료·향신료
    { emoji: '🧂', keywords: [
      '천일염', '굵은소금', '소금', '설탕', '흑설탕', '백설탕', '후추', '통후추', '조미료', '미원', '다시다',
      '카레가루', '카레분', '고춧가루', '맛술', '청주', '미림', '와사비', '겨자',
    ] },
    // 유제품·달걀
    { emoji: '🥚', keywords: ['계란', '달걀', '난황', '난백'] },
    { emoji: '🥛', keywords: ['우유', '요거트', '요구르트', '크림', '연유', '휘핑크림', '생크림'] },
    { emoji: '🧀', keywords: ['치즈', '모짜렐라', '체다', '파마산'] },
    { emoji: '🧈', keywords: ['버터', '마가린'] },
    // 곡물·밥·면
    { emoji: '🍚', keywords: ['쌀', '밥', '현미', '잡곡', '보리', '찹쌀', '흑미', '백미', '죽'] },
    { emoji: '🍜', keywords: ['라면', '우동', '국수', '냉면', '칼국수', '소바', '쫄면', '당면', '면'] },
    { emoji: '🍝', keywords: ['파스타', '스파게티', '펜네', '마카로니', '뇨끼'] },
    { emoji: '🍞', keywords: ['빵', '식빵', '바게트', '토스트', '베이글', '크루아상'] },
    // 김치·절임
    { emoji: '🥬', keywords: ['김치', '깍두기', '동치미', '나박김치', '파김치', '총각김치', '갓김치'] },
    // 고기
    { emoji: '🍗', keywords: ['닭고기', '닭가슴살', '닭다리', '닭', '치킨'] },
    { emoji: '🥓', keywords: ['베이컨', '햄', '소시지', '프랑크', '스팸'] },
    { emoji: '🥩', keywords: [
      '돼지고기', '소고기', '삼겹살', '목살', '갈비', '등심', '안심', '사태', '우둔', '차돌', '불고기',
      '오리고기', '양고기', '돈까스', '제육', '고기', '돼지', '소고기', '쇠고기',
    ] },
    // 해산물
    { emoji: '🦐', keywords: ['새우', '대하', '꽃새우', '새우살'] },
    { emoji: '🐟', keywords: [
      '연어', '참치', '고등어', '갈치', '명태', '동태', '광어', '우럭', '삼치', '전복', '조개', '홍합',
      '바지락', '굴', '오징어', '문어', '낙지', '주꾸미', '멸치', '생선', '해물', '어묵',
    ] },
    // 채소
    { emoji: '🍄', keywords: ['버섯', '표고', '새송이', '팽이', '느타리'] },
    { emoji: '🌶️', keywords: ['고추', '청양', '홍고추', '풋고추', '피망', '파프리카'] },
    { emoji: '🥕', keywords: ['당근'] },
    { emoji: '🥔', keywords: ['감자'] },
    { emoji: '🍅', keywords: ['토마토', '방울토마토'] },
    { emoji: '🧅', keywords: ['양파', '마늘', '대파', '쪽파', '파', '부추', '미나리', '쪽파'] },
    { emoji: '🥦', keywords: ['브로콜리', '콜리플라워'] },
    { emoji: '🥬', keywords: [
      '상추', '양배추', '배추', '시금치', '케일', '치커리', '로메인', '쑥갓', '미역', '다시마', '깻잎',
      '오이', '호박', '애호박', '가지', '무', '숙주', '콩나물', '시래기', '부추', '채소', '야채', '야채믹스',
      '샐러드', '양상추', '청경채', '배추', '파슬리',
    ] },
    // 과일
    { emoji: '🍎', keywords: [
      '사과', '배', '포도', '딸기', '블루베리', '라즈베리', '복숭아', '자두', '살구', '체리',
      '수박', '참외', '멜론', '귤', '오렌지', '한라봉', '레몬', '라임', '자몽', '키위', '망고', '바나나',
      '파인애플', '과일',
    ] },
    // 기타
    { emoji: '🫘', keywords: ['두부', '순두부', '콩', '대두', '완두콩', '강낭콩', '렌틸콩'] },
    { emoji: '🫒', keywords: ['올리브'] },
  ];

  /** 카테고리 기본 아이콘 (넓은 분류) */
  const CATEGORY_FALLBACKS = [
    { emoji: '🫙', keywords: ['장', '유', '오일', '즙'] },
    { emoji: '🧂', keywords: ['염', '가루', '분말'] },
    { emoji: '🥩', keywords: ['육', '고기'] },
    { emoji: '🐟', keywords: ['어', '해산', '물고기'] },
    { emoji: '🍎', keywords: ['과', 'fruit'] },
    { emoji: '🥬', keywords: ['채', '잎', '야채', 'vegetable'] },
  ];

  const sortedKeywordRules = KEYWORD_RULES.map((rule) => ({
    emoji: rule.emoji,
    keywords: [...rule.keywords].sort((a, b) => b.length - a.length),
  }));

  function normalizeIngredientName(name) {
    return String(name || '').trim().replace(/\s+/g, '');
  }

  function getIngredientEmoji(name) {
    const normalized = normalizeIngredientName(name);
    if (!normalized) return DEFAULT_EMOJI;

    if (EXACT_EMOJI[normalized]) return EXACT_EMOJI[normalized];

    for (const rule of sortedKeywordRules) {
      for (const keyword of rule.keywords) {
        if (normalized.includes(keyword)) return rule.emoji;
      }
    }

    for (const category of CATEGORY_FALLBACKS) {
      for (const keyword of category.keywords) {
        if (normalized.includes(keyword)) return category.emoji;
      }
    }

    return DEFAULT_EMOJI;
  }

  window.IngredientEmojiUtil = {
    getIngredientEmoji,
    normalizeIngredientName,
    DEFAULT_EMOJI,
  };
})();
