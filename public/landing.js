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
  var productWindow = document.querySelector('.product-window');
  var productSwitchTimer = null;
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
    var previousIndex = productIndex;
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

    if (productWindow && productIndex !== previousIndex && !motionQuery.matches) {
      window.clearTimeout(productSwitchTimer);
      productWindow.classList.remove('is-switching');
      void productWindow.offsetWidth;
      productWindow.classList.add('is-switching');
      productSwitchTimer = window.setTimeout(function () {
        productWindow.classList.remove('is-switching');
      }, 850);
    }

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

  var pixelCanvas = document.getElementById('data-pixel-arc');
  var pixelContext = pixelCanvas ? pixelCanvas.getContext('2d') : null;
  var heroElement = document.querySelector('.hero');

  if (pixelContext && heroElement) {
    var pixelWidth = 0;
    var pixelHeight = 0;
    var pixelArcVisible = true;
    var pixelArcFrame = 0;
    var pixelArcLastDraw = 0;

    function resizePixelArc() {
      var bounds = pixelCanvas.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      var pixelRatio = Math.min(window.devicePixelRatio || 1, window.innerWidth < 680 ? 1.25 : 1.5);
      pixelWidth = bounds.width;
      pixelHeight = bounds.height;
      pixelCanvas.width = Math.round(pixelWidth * pixelRatio);
      pixelCanvas.height = Math.round(pixelHeight * pixelRatio);
      pixelContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      drawPixelArc(0);
    }

    function drawPixelArc(time) {
      pixelContext.clearRect(0, 0, pixelWidth, pixelHeight);
      var compact = window.innerWidth < 680;
      var spacing = compact ? 9 : 10;
      var squareSize = compact ? 5.5 : 6.5;
      var centerX = pixelWidth * (compact ? .58 : .66);
      var arcSpan = pixelWidth * (compact ? .78 : .72);
      var arcTop = pixelHeight * (compact ? .46 : .26);
      var arcDepth = pixelHeight * (compact ? .52 : .68);
      var bandWidth = pixelHeight * (compact ? .095 : .12);
      var phase = time * .00022 + productIndex * .48;

      pixelContext.save();
      pixelContext.globalCompositeOperation = 'screen';
      pixelContext.fillStyle = '#61e2ba';

      for (var x = -spacing; x <= pixelWidth + spacing; x += spacing) {
        var normalizedX = (x - centerX) / arcSpan;
        var curveY = arcTop + normalizedX * normalizedX * arcDepth;
        curveY += Math.sin(normalizedX * 4.2 + phase) * pixelHeight * .012;
        var edgeFade = Math.max(0, 1 - Math.abs(normalizedX) * .68);

        for (var y = curveY - bandWidth; y <= curveY + bandWidth; y += spacing) {
          if (y < -spacing || y > pixelHeight + spacing) continue;
          var distance = Math.abs(y - curveY) / bandWidth;
          var bandFade = Math.max(0, 1 - distance);
          var breathing = .72 + Math.sin(phase * 1.6 + x * .012 + y * .006) * .18;
          var alpha = bandFade * bandFade * edgeFade * breathing * .56;
          if (alpha < .025) continue;
          pixelContext.globalAlpha = alpha;
          pixelContext.fillRect(x, y, squareSize, squareSize);
        }
      }

      pixelContext.restore();
    }

    function pixelArcCanMove() {
      return pixelArcVisible && !document.hidden && !motionQuery.matches;
    }

    function renderPixelArc(time) {
      if (!pixelArcCanMove()) {
        pixelArcFrame = 0;
        return;
      }
      var interval = window.innerWidth < 680 ? 38 : 30;
      if (time - pixelArcLastDraw >= interval) {
        drawPixelArc(time);
        pixelArcLastDraw = time;
      }
      pixelArcFrame = window.requestAnimationFrame(renderPixelArc);
    }

    function syncPixelArc() {
      window.cancelAnimationFrame(pixelArcFrame);
      pixelArcFrame = 0;
      if (pixelArcCanMove()) pixelArcFrame = window.requestAnimationFrame(renderPixelArc);
      else drawPixelArc(0);
    }

    if ('ResizeObserver' in window) new ResizeObserver(resizePixelArc).observe(heroElement);
    else window.addEventListener('resize', resizePixelArc);

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        pixelArcVisible = entries[0].isIntersecting;
        syncPixelArc();
      }, { threshold: .05 }).observe(heroElement);
    }

    document.addEventListener('visibilitychange', syncPixelArc);
    motionQuery.addEventListener('change', syncPixelArc);
    resizePixelArc();
    syncPixelArc();
  }
}());
