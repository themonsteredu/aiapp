'use strict';

// 프로그램 소개(/info) — 좁은 화면 메뉴만 연다. 랜딩의 슬라이더 코드는 이 페이지에 없다.
(function () {
  var menuToggle = document.getElementById('menu-toggle');
  var menu = document.getElementById('menu');
  if (!menuToggle || !menu) return;

  function closeMenu() {
    menu.classList.remove('open');
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.setAttribute('aria-label', '메뉴 열기');
  }

  menuToggle.addEventListener('click', function () {
    var opened = menu.classList.toggle('open');
    menuToggle.setAttribute('aria-expanded', String(opened));
    menuToggle.setAttribute('aria-label', opened ? '메뉴 닫기' : '메뉴 열기');
  });

  menu.querySelectorAll('a').forEach(function (link) {
    link.addEventListener('click', closeMenu);
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeMenu();
  });
}());
