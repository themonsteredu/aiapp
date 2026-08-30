'use strict';

(function () {
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var revealObserver = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries, observer) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('in');
      observer.unobserve(entry.target);
    });
  }, { threshold: .14 }) : null;

  document.querySelectorAll('.reveal').forEach(function (element) {
    var delay = Number(element.dataset.delay || 0);
    if (delay) element.style.transitionDelay = delay + 'ms';
    if (revealObserver) revealObserver.observe(element);
    else element.classList.add('in');
  });

  var menuToggle = document.getElementById('menu-toggle');
  var menu = document.getElementById('menu');

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

  var gallery = document.getElementById('hero-gallery');
  var frames = Array.prototype.slice.call(gallery.querySelectorAll('.hero-frame'));
  var galleryIndex = 0;
  var galleryTimer = null;
  var galleryPausedByUser = false;
  var heroStep = document.getElementById('hero-step');
  var heroLabel = document.getElementById('hero-label');
  var galleryCurrent = document.getElementById('gallery-current');
  var galleryToggle = document.getElementById('gallery-toggle');
  var progress = document.getElementById('hero-progress');

  function restartProgress() {
    if (reducedMotion || galleryPausedByUser) return;
    progress.classList.remove('is-running');
    void progress.offsetWidth;
    progress.classList.add('is-running');
  }

  function showFrame(nextIndex) {
    galleryIndex = (nextIndex + frames.length) % frames.length;
    frames.forEach(function (frame, index) {
      var active = index === galleryIndex;
      frame.classList.toggle('is-active', active);
      frame.setAttribute('aria-hidden', String(!active));
    });
    var currentFrame = frames[galleryIndex];
    heroStep.textContent = currentFrame.dataset.step;
    heroLabel.textContent = currentFrame.dataset.label;
    galleryCurrent.textContent = String(galleryIndex + 1).padStart(2, '0');
    restartProgress();
  }

  function startGallery() {
    if (reducedMotion || galleryPausedByUser) return;
    window.clearInterval(galleryTimer);
    galleryTimer = window.setInterval(function () { showFrame(galleryIndex + 1); }, 5200);
    restartProgress();
  }

  function pauseGallery() {
    window.clearInterval(galleryTimer);
    progress.classList.remove('is-running');
  }

  document.getElementById('gallery-prev').addEventListener('click', function () {
    showFrame(galleryIndex - 1);
    startGallery();
  });

  document.getElementById('gallery-next').addEventListener('click', function () {
    showFrame(galleryIndex + 1);
    startGallery();
  });

  galleryToggle.addEventListener('click', function () {
    galleryPausedByUser = !galleryPausedByUser;
    galleryToggle.setAttribute('aria-pressed', String(galleryPausedByUser));
    galleryToggle.setAttribute('aria-label', galleryPausedByUser ? '사진 자동 전환 시작하기' : '사진 자동 전환 멈추기');
    galleryToggle.textContent = galleryPausedByUser ? '▶' : 'Ⅱ';
    if (galleryPausedByUser) pauseGallery();
    else startGallery();
  });

  gallery.addEventListener('mouseenter', pauseGallery);
  gallery.addEventListener('mouseleave', startGallery);
  gallery.addEventListener('focusin', pauseGallery);
  gallery.addEventListener('focusout', function (event) {
    if (!gallery.contains(event.relatedTarget)) startGallery();
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) pauseGallery();
    else startGallery();
  });

  showFrame(0);
  startGallery();

  var outputImage = document.getElementById('output-image');
  var outputCaption = document.getElementById('output-caption');
  var outputOptions = document.querySelectorAll('.output-option');

  outputOptions.forEach(function (option) {
    option.addEventListener('click', function () {
      if (option.getAttribute('aria-pressed') === 'true') return;
      outputOptions.forEach(function (item) { item.setAttribute('aria-pressed', String(item === option)); });
      outputImage.classList.add('is-changing');
      window.setTimeout(function () {
        outputImage.src = option.dataset.src;
        outputImage.alt = option.dataset.alt;
        outputCaption.textContent = option.dataset.caption;
        window.requestAnimationFrame(function () { outputImage.classList.remove('is-changing'); });
      }, reducedMotion ? 0 : 170);
    });
  });
}());
