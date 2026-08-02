/**
 * 이용약관 본문 (수정은 이 파일만)
 * PLACEHOLDER — 최종 법률 원문으로 교체하세요.
 */
(function initTermsContent(global) {
  global.LEGAL_TERMS = {
    id: 'terms',
    title: '이용약관',
    updatedLabel: '최종 업데이트: (작성 예정)',
    sections: [
      {
        heading: '안내',
        paragraphs: [
          '이 페이지는 이용약관 placeholder입니다.',
          '서비스 이용 조건에 대한 최종 원문이 준비되면 이 파일의 내용을 교체해 주세요.',
        ],
      },
      {
        heading: '서비스 이용 (작성 예정)',
        paragraphs: [
          '계정, 콘텐츠, 금지 행위, 책임 제한 등 이용약관 조항을 여기에 기재합니다.',
        ],
      },
      {
        heading: '문의 (작성 예정)',
        paragraphs: [
          '이용약관 관련 문의 채널을 여기에 기재합니다.',
        ],
      },
    ],
  };
})(typeof window !== 'undefined' ? window : globalThis);
