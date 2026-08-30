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
  var productTones = [
    { color: '#61e2ba', rgb: '97, 226, 186', channels: [97, 226, 186] },
    { color: '#65bdf5', rgb: '101, 189, 245', channels: [101, 189, 245] },
    { color: '#efb65f', rgb: '239, 182, 95', channels: [239, 182, 95] },
    { color: '#b59bf4', rgb: '181, 155, 244', channels: [181, 155, 244] }
  ];
  var ribbonToneFrom = productTones[0].channels.slice();
  var ribbonToneTarget = productTones[0].channels.slice();
  var ribbonToneChangedAt = 0;
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
    var currentTone = productTones[productIndex];
    productLabel.textContent = currentSlide.dataset.label;
    productKicker.textContent = currentSlide.dataset.kicker;
    productCurrent.textContent = String(productIndex + 1).padStart(2, '0');
    productSlider.style.setProperty('--showcase-accent', currentTone.color);
    productSlider.style.setProperty('--showcase-accent-rgb', currentTone.rgb);

    if (productIndex !== previousIndex) {
      var toneChangeTime = performance.now();
      ribbonToneFrom = currentRibbonTone(toneChangeTime);
      ribbonToneTarget = currentTone.channels.slice();
      ribbonToneChangedAt = toneChangeTime;
    }

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

  var ribbonCanvas = document.getElementById('silk-ribbon-field');
  var ribbonContext = ribbonCanvas ? ribbonCanvas.getContext('2d') : null;
  var heroElement = document.querySelector('.hero');

  function currentRibbonTone(time) {
    var elapsed = Math.max(0, time - ribbonToneChangedAt);
    var amount = ribbonToneChangedAt ? Math.min(1, elapsed / 1100) : 1;
    amount = amount * amount * (3 - 2 * amount);
    return ribbonToneFrom.map(function (channel, index) {
      return Math.round(channel + (ribbonToneTarget[index] - channel) * amount);
    });
  }

  function ribbonRgba(tone, alpha) {
    return 'rgba(' + tone[0] + ', ' + tone[1] + ', ' + tone[2] + ', ' + alpha + ')';
  }

  if (ribbonContext && heroElement) {
    var ribbonWidth = 0;
    var ribbonHeight = 0;
    var ribbonVisible = true;
    var ribbonFrame = 0;
    var ribbonLastDraw = 0;

    function resizeSilkRibbon() {
      var bounds = ribbonCanvas.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      var pixelRatio = Math.min(window.devicePixelRatio || 1, window.innerWidth < 680 ? 1.2 : 1.4);
      ribbonWidth = bounds.width;
      ribbonHeight = bounds.height;
      ribbonCanvas.width = Math.round(ribbonWidth * pixelRatio);
      ribbonCanvas.height = Math.round(ribbonHeight * pixelRatio);
      ribbonContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      drawSilkRibbon(performance.now());
    }

    function ribbonPoint(progress, phase, compact) {
      var slope = compact ? .12 : .24;
      var base = ribbonHeight * (compact ? .59 : .66);
      var wave = Math.sin(progress * Math.PI * 1.7 + phase) * ribbonHeight * (compact ? .055 : .078);
      var fold = Math.sin(progress * Math.PI * 3.4 - phase * .62) * ribbonHeight * (compact ? .018 : .026);
      return base - progress * ribbonHeight * slope + wave + fold;
    }

    function buildRibbonPath(phase, compact) {
      var path = new Path2D();
      var samples = compact ? 42 : 58;
      var topPoints = [];
      var bottomPoints = [];

      for (var sample = 0; sample <= samples; sample += 1) {
        var progress = sample / samples;
        var x = -ribbonWidth * .08 + progress * ribbonWidth * 1.16;
        var centerY = ribbonPoint(progress, phase, compact);
        var breath = .91 + Math.sin(progress * Math.PI * 2.2 - phase * .72) * .09;
        var halfWidth = ribbonHeight * (compact ? .115 : .155) * breath;
        topPoints.push([x, centerY - halfWidth]);
        bottomPoints.push([x, centerY + halfWidth]);
      }

      path.moveTo(topPoints[0][0], topPoints[0][1]);
      topPoints.slice(1).forEach(function (point) { path.lineTo(point[0], point[1]); });
      bottomPoints.reverse().forEach(function (point) { path.lineTo(point[0], point[1]); });
      path.closePath();
      return path;
    }

    function drawSilkRibbon(time) {
      ribbonContext.clearRect(0, 0, ribbonWidth, ribbonHeight);
      var compact = window.innerWidth < 680;
      var phase = time * .00034 + productIndex * .16;
      var tone = currentRibbonTone(time);
      var path = buildRibbonPath(phase, compact);
      var surfaceGradient = ribbonContext.createLinearGradient(0, ribbonHeight * .28, ribbonWidth, ribbonHeight * .74);
      surfaceGradient.addColorStop(0, ribbonRgba(tone, 0));
      surfaceGradient.addColorStop(.16, ribbonRgba(tone, compact ? .13 : .18));
      surfaceGradient.addColorStop(.48, ribbonRgba(tone, compact ? .38 : .48));
      surfaceGradient.addColorStop(.73, ribbonRgba(tone, compact ? .2 : .28));
      surfaceGradient.addColorStop(1, ribbonRgba(tone, 0));

      ribbonContext.save();
      ribbonContext.globalCompositeOperation = 'screen';
      ribbonContext.shadowColor = ribbonRgba(tone, .42);
      ribbonContext.shadowBlur = compact ? 28 : 52;
      ribbonContext.fillStyle = surfaceGradient;
      ribbonContext.fill(path);
      ribbonContext.shadowBlur = 0;
      ribbonContext.clip(path);

      var sheenX = ((time * .032) % (ribbonWidth * 1.55)) - ribbonWidth * .28;
      var sheen = ribbonContext.createLinearGradient(sheenX - ribbonWidth * .18, 0, sheenX + ribbonWidth * .18, 0);
      sheen.addColorStop(0, 'rgba(255,255,255,0)');
      sheen.addColorStop(.46, ribbonRgba(tone, .06));
      sheen.addColorStop(.5, 'rgba(239,255,250,.34)');
      sheen.addColorStop(.54, ribbonRgba(tone, .08));
      sheen.addColorStop(1, 'rgba(255,255,255,0)');
      ribbonContext.fillStyle = sheen;
      ribbonContext.fillRect(0, 0, ribbonWidth, ribbonHeight);

      var depthShade = ribbonContext.createLinearGradient(0, ribbonHeight * .38, 0, ribbonHeight * .77);
      depthShade.addColorStop(0, 'rgba(255,255,255,.18)');
      depthShade.addColorStop(.28, 'rgba(255,255,255,.015)');
      depthShade.addColorStop(.64, 'rgba(0,18,15,.22)');
      depthShade.addColorStop(1, 'rgba(255,255,255,.06)');
      ribbonContext.fillStyle = depthShade;
      ribbonContext.fillRect(0, 0, ribbonWidth, ribbonHeight);
      ribbonContext.restore();

      ribbonContext.save();
      ribbonContext.globalCompositeOperation = 'screen';
      ribbonContext.strokeStyle = 'rgba(229,255,248,.22)';
      ribbonContext.lineWidth = compact ? .7 : 1;
      ribbonContext.beginPath();
      for (var lineSample = 0; lineSample <= 60; lineSample += 1) {
        var lineProgress = lineSample / 60;
        var lineX = -ribbonWidth * .08 + lineProgress * ribbonWidth * 1.16;
        var lineY = ribbonPoint(lineProgress, phase, compact) - ribbonHeight * (compact ? .038 : .052);
        if (lineSample === 0) ribbonContext.moveTo(lineX, lineY);
        else ribbonContext.lineTo(lineX, lineY);
      }
      ribbonContext.stroke();
      ribbonContext.restore();
    }

    function silkRibbonCanMove() {
      return ribbonVisible && !document.hidden && !motionQuery.matches;
    }

    function renderSilkRibbon(time) {
      if (!silkRibbonCanMove()) {
        ribbonFrame = 0;
        return;
      }
      var interval = window.innerWidth < 680 ? 46 : 40;
      if (time - ribbonLastDraw >= interval) {
        drawSilkRibbon(time);
        ribbonLastDraw = time;
      }
      ribbonFrame = window.requestAnimationFrame(renderSilkRibbon);
    }

    function syncSilkRibbon() {
      window.cancelAnimationFrame(ribbonFrame);
      ribbonFrame = 0;
      if (silkRibbonCanMove()) ribbonFrame = window.requestAnimationFrame(renderSilkRibbon);
      else drawSilkRibbon(performance.now());
    }

    if ('ResizeObserver' in window) new ResizeObserver(resizeSilkRibbon).observe(heroElement);
    else window.addEventListener('resize', resizeSilkRibbon);

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        ribbonVisible = entries[0].isIntersecting;
        syncSilkRibbon();
      }, { threshold: .05 }).observe(heroElement);
    }

    document.addEventListener('visibilitychange', syncSilkRibbon);
    motionQuery.addEventListener('change', syncSilkRibbon);
    resizeSilkRibbon();
    syncSilkRibbon();
  }
}());
