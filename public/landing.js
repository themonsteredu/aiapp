'use strict';

(function () {
  var motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

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

  var productSlider = document.getElementById('product-slider');
  var productTrack = document.getElementById('product-track');
  var productSlides = Array.prototype.slice.call(document.querySelectorAll('.product-slide'));
  var productIndex = 0;
  var productTimer = null;
  var productPausedByUser = false;
  var productHovered = false;
  var productFocused = false;
  var productVisible = true;
  var productLabel = document.getElementById('product-label');
  var productKicker = document.getElementById('product-kicker');
  var productCurrent = document.getElementById('product-current');
  var productToggle = document.getElementById('product-toggle');
  var productProgress = document.getElementById('product-progress');
  var swipeStartX = null;
  var swipePointerId = null;

  function canAutoPlay() {
    return !motionQuery.matches && !productPausedByUser && !productHovered && !productFocused && productVisible && !document.hidden;
  }

  function restartProductProgress() {
    productProgress.classList.remove('is-running');
    if (!canAutoPlay()) return;
    void productProgress.offsetWidth;
    productProgress.classList.add('is-running');
  }

  function showProduct(nextIndex) {
    productIndex = (nextIndex + productSlides.length) % productSlides.length;
    productTrack.style.transform = 'translate3d(-' + (productIndex * 100) + '%, 0, 0)';
    productSlides.forEach(function (slide, index) {
      var active = index === productIndex;
      slide.classList.toggle('is-active', active);
      slide.setAttribute('aria-hidden', String(!active));
    });

    var currentSlide = productSlides[productIndex];
    productLabel.textContent = currentSlide.dataset.label;
    productKicker.textContent = currentSlide.dataset.kicker;
    productCurrent.textContent = String(productIndex + 1).padStart(2, '0');
    restartProductProgress();
  }

  function stopProductSlider() {
    window.clearInterval(productTimer);
    productTimer = null;
    productProgress.classList.remove('is-running');
  }

  function syncProductSlider() {
    stopProductSlider();
    if (!canAutoPlay()) return;
    productTimer = window.setInterval(function () { showProduct(productIndex + 1); }, 5000);
    restartProductProgress();
  }

  function updateProductToggle() {
    if (motionQuery.matches) {
      productToggle.disabled = true;
      productToggle.textContent = '▶';
      productToggle.setAttribute('aria-label', '모션 감축 설정으로 자동 전환 꺼짐');
      return;
    }

    productToggle.disabled = false;
    productToggle.textContent = productPausedByUser ? '▶' : 'Ⅱ';
    productToggle.setAttribute('aria-pressed', String(productPausedByUser));
    productToggle.setAttribute('aria-label', productPausedByUser ? '웹앱 자동 전환 시작하기' : '웹앱 자동 전환 멈추기');
  }

  document.getElementById('product-prev').addEventListener('click', function () {
    showProduct(productIndex - 1);
    syncProductSlider();
  });

  document.getElementById('product-next').addEventListener('click', function () {
    showProduct(productIndex + 1);
    syncProductSlider();
  });

  productToggle.addEventListener('click', function () {
    productPausedByUser = !productPausedByUser;
    updateProductToggle();
    syncProductSlider();
  });

  productSlider.addEventListener('mouseenter', function () {
    productHovered = true;
    syncProductSlider();
  });

  productSlider.addEventListener('mouseleave', function () {
    productHovered = false;
    syncProductSlider();
  });

  productSlider.addEventListener('focusin', function () {
    productFocused = true;
    syncProductSlider();
  });

  productSlider.addEventListener('focusout', function (event) {
    if (productSlider.contains(event.relatedTarget)) return;
    productFocused = false;
    syncProductSlider();
  });

  productTrack.addEventListener('pointerdown', function (event) {
    if (!event.isPrimary) return;
    swipeStartX = event.clientX;
    swipePointerId = event.pointerId;
  });

  productTrack.addEventListener('pointerup', function (event) {
    if (swipeStartX === null || event.pointerId !== swipePointerId) return;
    var distance = event.clientX - swipeStartX;
    swipeStartX = null;
    swipePointerId = null;
    if (Math.abs(distance) < 45) return;
    showProduct(productIndex + (distance < 0 ? 1 : -1));
    syncProductSlider();
  });

  productTrack.addEventListener('pointercancel', function () {
    swipeStartX = null;
    swipePointerId = null;
  });

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      productVisible = entries[0].isIntersecting;
      syncProductSlider();
    }, { threshold: .05 }).observe(productSlider);
  }

  document.addEventListener('visibilitychange', syncProductSlider);
  motionQuery.addEventListener('change', function () {
    updateProductToggle();
    syncProductSlider();
  });

  showProduct(0);
  updateProductToggle();
  syncProductSlider();

  var horizonCanvas = document.getElementById('emerald-horizon');
  var horizonContext = horizonCanvas ? horizonCanvas.getContext('2d') : null;

  if (horizonContext) {
    var horizonWidth = 0;
    var horizonHeight = 0;
    var horizonVisible = true;
    var horizonFrame = 0;
    var horizonLastDraw = 0;

    function resizeHorizon() {
      var bounds = horizonCanvas.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      var pixelRatio = Math.min(window.devicePixelRatio || 1, window.innerWidth < 680 ? 1.25 : 1.5);
      horizonWidth = bounds.width;
      horizonHeight = bounds.height;
      horizonCanvas.width = Math.round(horizonWidth * pixelRatio);
      horizonCanvas.height = Math.round(horizonHeight * pixelRatio);
      horizonContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      drawHorizon(0);
    }

    function curvePoints(base, amplitude, phase, offset) {
      var points = [];
      var count = window.innerWidth < 680 ? 48 : 64;
      for (var point = 0; point <= count; point += 1) {
        var x = horizonWidth * point / count;
        var wave = Math.sin((point / count) * Math.PI * 2.1 + phase + offset) * amplitude;
        var detail = Math.sin((point / count) * Math.PI * 4.4 - phase * .55 + offset) * amplitude * .28;
        points.push([x, base + wave + detail]);
      }
      return points;
    }

    function traceCurve(points) {
      horizonContext.beginPath();
      horizonContext.moveTo(points[0][0], points[0][1]);
      for (var index = 1; index < points.length; index += 1) {
        horizonContext.lineTo(points[index][0], points[index][1]);
      }
    }

    function drawBand(points, opacity) {
      var gradient = horizonContext.createLinearGradient(0, horizonHeight * .55, 0, horizonHeight);
      gradient.addColorStop(0, 'rgba(42, 204, 163, 0)');
      gradient.addColorStop(.2, 'rgba(42, 204, 163, ' + (opacity * .55) + ')');
      gradient.addColorStop(1, 'rgba(5, 59, 49, 0)');

      traceCurve(points);
      horizonContext.lineTo(horizonWidth, horizonHeight);
      horizonContext.lineTo(0, horizonHeight);
      horizonContext.closePath();
      horizonContext.fillStyle = gradient;
      horizonContext.fill();

      traceCurve(points);
      horizonContext.strokeStyle = 'rgba(66, 224, 184, ' + (opacity * .2) + ')';
      horizonContext.lineWidth = 16;
      horizonContext.stroke();
      traceCurve(points);
      horizonContext.strokeStyle = 'rgba(91, 234, 197, ' + (opacity * .42) + ')';
      horizonContext.lineWidth = 5;
      horizonContext.stroke();
      traceCurve(points);
      horizonContext.strokeStyle = 'rgba(150, 245, 221, ' + opacity + ')';
      horizonContext.lineWidth = 1;
      horizonContext.stroke();
    }

    function drawHorizon(time) {
      horizonContext.clearRect(0, 0, horizonWidth, horizonHeight);
      var phase = time * .00012;
      var compact = window.innerWidth < 680;
      var bandCount = compact ? 2 : 3;

      horizonContext.save();
      horizonContext.globalCompositeOperation = 'screen';
      for (var band = bandCount - 1; band >= 0; band -= 1) {
        var base = horizonHeight * (.63 + band * .09);
        var amplitude = horizonHeight * (.026 + band * .008);
        var points = curvePoints(base, amplitude, phase * (1 + band * .16), band * 1.7);
        drawBand(points, .2 + band * .07);
      }
      horizonContext.restore();
    }

    function horizonCanMove() {
      return horizonVisible && !document.hidden && !motionQuery.matches;
    }

    function renderHorizon(time) {
      if (!horizonCanMove()) {
        horizonFrame = 0;
        return;
      }
      var interval = window.innerWidth < 680 ? 33 : 24;
      if (time - horizonLastDraw >= interval) {
        drawHorizon(time);
        horizonLastDraw = time;
      }
      horizonFrame = window.requestAnimationFrame(renderHorizon);
    }

    function syncHorizon() {
      window.cancelAnimationFrame(horizonFrame);
      horizonFrame = 0;
      if (horizonCanMove()) horizonFrame = window.requestAnimationFrame(renderHorizon);
      else drawHorizon(0);
    }

    if ('ResizeObserver' in window) new ResizeObserver(resizeHorizon).observe(productSlider);
    else window.addEventListener('resize', resizeHorizon);

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        horizonVisible = entries[0].isIntersecting;
        syncHorizon();
      }, { threshold: .05 }).observe(productSlider);
    }

    document.addEventListener('visibilitychange', syncHorizon);
    motionQuery.addEventListener('change', syncHorizon);
    resizeHorizon();
    syncHorizon();
  }
}());
