'use strict';

// 프로그램 소개(/info) — 좁은 화면 메뉴와 분야 필터. 랜딩의 슬라이더 코드는 이 페이지에 없다.
(function () {
  var filterButtons = document.querySelectorAll('.pf-btn');
  var parts = document.querySelectorAll('.part');
  filterButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      var part = button.dataset.part;
      filterButtons.forEach(function (other) { other.setAttribute('aria-pressed', String(other === button)); });
      parts.forEach(function (section) { section.hidden = part !== 'all' && section.dataset.part !== part; });
      var programs = document.getElementById('programs');
      if (programs && programs.getBoundingClientRect().top < 0) programs.scrollIntoView({ block: 'start' });
    });
  });
}());

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

// 수업 카드를 누르면 그 수업의 홍보영상을 팝업으로 연다. 닫으면 멈추고 내려받기를 끊는다.
(function () {
  var dialog = document.getElementById('video-dialog');
  if (!dialog) return;
  var video = dialog.querySelector('video');
  var title = document.getElementById('vp-title');
  var opener = null;

  function close() {
    if (dialog.open) dialog.close();
  }

  document.querySelectorAll('.pc-open').forEach(function (button) {
    button.addEventListener('click', function () {
      var src = button.dataset.video;
      if (typeof dialog.showModal !== 'function') {
        window.open(src, '_blank', 'noopener');
        return;
      }
      opener = button;
      title.textContent = button.dataset.title + ' · 홍보영상';
      video.src = src;
      dialog.showModal();
      var playing = video.play();
      if (playing && playing.catch) playing.catch(function () {});
    });
  });

  dialog.querySelector('.vp-close').addEventListener('click', close);
  dialog.addEventListener('click', function (event) {
    if (event.target === dialog) close();
  });
  dialog.addEventListener('close', function () {
    video.pause();
    video.removeAttribute('src');
    video.load();
    if (opener) opener.focus();
  });
}());
