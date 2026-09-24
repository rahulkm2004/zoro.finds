    function updateLandingPage() {
        const activeHoodies = HOODIES.filter(h => h.status !== "sold").length;
        const activeJackets = PRODUCTS.filter(j => j.status !== "sold").length;

        mainEl.innerHTML = \
            <div class="editorial-landing cinematic-theme">
                
                <!-- TOP NAVIGATION (INSPIRED BY REFERENCE) -->
                <nav class="premium-top-nav">
                    <div class="nav-left">
                        <a onclick="goToHome()">HOME</a>
                        <a onclick="goToCollection('HOODIES')">HOODIES</a>
                        <a onclick="goToCollection('JACKETS')">JACKETS</a>
                        <a onclick="goToCollection('ARCHIVE')">ARCHIVE</a>
                    </div>
                    <div class="nav-right">
                        <a href="#reviewsSection">REVIEWS</a>
                        <a onclick="openCartDrawer()">BAG (<span id="topCartCountNav">0</span>)</a>
                    </div>
                </nav>

                <!-- HERO VIDEO & EDITORIAL MONOLITH -->
                <section class="editorial-hero-wrapper" aria-label="Brand Hero Video">
                    <div class="hero-video-container">
                        <video class="hero-video-media" autoplay loop muted playsinline preload="metadata">
                            <source src="images/hero-video.mp4" type="video/mp4">
                        </video>
                        <div class="hero-video-overlay cinematic-overlay"></div>
                        
                        <!-- Cursor-reactive Zoro character panel -->
                        <div id="heroCharPanel" class="hero-char-panel" aria-label="Interactive Zoro character">
                            <img
                                id="heroCharImg"
                                class="hero-char-img"
                                src="images/zoro/center.png"
                                alt="Zoro"
                                loading="eager"
                                decoding="async"
                                draggable="false"
                            />
                        </div>
                        
                        <div class="hero-content-box cinematic-layout">
                            <div class="hero-branding">
                                <h1 class="hero-main-title oversize-brand">ZORO.FINDS</h1>
                                <p class="hero-subtitle editorial-text">ONE-OF-ONE THRIFT.<br>RARE FINDS.<br>BUILT TO BE WORN.</p>
                            </div>
                            <div class="hero-actions-row cinematic-actions">
                                <button type="button" class="hero-cta-btn modern-btn" onclick="goToCollection('JACKETS')">SHOP JACKETS <span class="count">(\)</span></button>
                                <button type="button" class="hero-cta-btn secondary modern-btn" onclick="goToCollection('HOODIES')">SHOP HOODIES <span class="count">(\)</span></button>
                            </div>
                        </div>
                    </div>
                </section>

                <!-- ABOUT ZORO.FINDS -->
                <section class="brand-story-section">
                    <div class="story-container">
                        <h2 class="reveal-text">ONE-OF-ONE THRIFT</h2>
                        <h2 class="reveal-text">RARE FINDS</h2>
                        <h2 class="reveal-text">VINTAGE STREETWEAR</h2>
                        <h2 class="reveal-text">BUILT TO BE WORN</h2>
                    </div>
                </section>

                <!-- IMAGE COMPOSITION (EDITORIAL) -->
                <section class="editorial-image-composition" id="editorialImages">
                    <div class="img-comp-layer comp-bg"><img src="images/media_1789407098579.jpg" loading="lazy"></div>
                    <div class="img-comp-layer comp-fg-1"><img src="images/media_1789407110424.jpg" loading="lazy"></div>
                    <div class="img-comp-layer comp-fg-2"><img src="images/zf001-1.jpg" loading="lazy"></div>
                </section>

                <!-- SCROLL MARQUEE SECTION -->
                <section class="marquee-section">
                    <div class="marquee-track" id="marqueeTrack">
                        <img src="images/media_1789407047554.jpg" alt="Archive" class="marquee-img">
                        <img src="images/zf002-1.jpg" alt="Archive" class="marquee-img">
                        <img src="images/media_1789406973444.jpg" alt="Archive" class="marquee-img">
                        <img src="images/zf005-1.jpg" alt="Archive" class="marquee-img">
                        <img src="images/media_1789406848619.jpg" alt="Archive" class="marquee-img">
                    </div>
                </section>

                <!-- WHITE INFORMATION SECTION -->
                <section class="white-info-section">
                    <h2 class="drop-heading">THE DROP</h2>
                    <div class="info-list">
                        <div class="info-row" onclick="goToCollection('HOODIES')">
                            <span class="info-num">01</span>
                            <span class="info-title">HOODIES</span>
                            <span class="info-arrow">?</span>
                        </div>
                        <div class="info-row" onclick="goToCollection('JACKETS')">
                            <span class="info-num">02</span>
                            <span class="info-title">JACKETS</span>
                            <span class="info-arrow">?</span>
                        </div>
                        <div class="info-row" onclick="goToCollection('ARCHIVE')">
                            <span class="info-num">03</span>
                            <span class="info-title">ONE-OF-ONE PIECES</span>
                            <span class="info-arrow">?</span>
                        </div>
                        <div class="info-row">
                            <span class="info-num">04</span>
                            <span class="info-title">PAN-INDIA SHIPPING</span>
                            <span class="info-arrow"></span>
                        </div>
                        <div class="info-row">
                            <span class="info-num">05</span>
                            <span class="info-title">COD AVAILABLE</span>
                            <span class="info-arrow"></span>
                        </div>
                    </div>
                </section>

                <!-- ARCHIVE LAYERED SHOWCASE -->
                <section class="archive-showcase-section">
                    <div class="sticky-container">
                        <h2 class="archive-title">THE ARCHIVE</h2>
                        <div class="layered-cards-container">
                            <div class="archive-card card-1" onclick="goToCollection('HOODIES')">
                                <img src="images/zf011-1.jpg" alt="Hoodies" loading="lazy">
                                <div class="archive-card-label">ZF-011 / DROP 02</div>
                            </div>
                            <div class="archive-card card-2" onclick="goToCollection('JACKETS')">
                                <img src="images/zf015-1.jpg" alt="Jackets" loading="lazy">
                                <div class="archive-card-label">ZF-015 / DROP 01</div>
                            </div>
                            <div class="archive-card card-3" onclick="goToCollection('ARCHIVE')">
                                <img src="images/media_1789406910415.jpg" alt="Archive" loading="lazy">
                                <div class="archive-card-label">ARCHIVE PIECE</div>
                            </div>
                        </div>
                    </div>
                </section>

                <!-- REVIEWS SECTION -->
                <section class="reviews-section" id="reviewsSection">
                    <div class="reviews-inner">
                        <div class="reviews-header">
                            <h2 class="reviews-title" style="margin: 0;">YOU FOUND IT. THEY WORE IT.</h2>
                        </div>
                        <div class="reviews-grid">
                            <div class="review-card" onclick="openReviewModal('images/review-1.jpg')"><div class="review-img-wrap"><img src="images/review-1.jpg" loading="lazy"></div></div>
                            <div class="review-card" onclick="openReviewModal('images/review-2.jpg')"><div class="review-img-wrap"><img src="images/review-2.jpg" loading="lazy"></div></div>
                            <div class="review-card" onclick="openReviewModal('images/review-3.jpg')"><div class="review-img-wrap"><img src="images/review-3.jpg" loading="lazy"></div></div>
                            <div class="review-card" onclick="openReviewModal('images/review-4.jpg')"><div class="review-img-wrap"><img src="images/review-4.jpg" loading="lazy"></div></div>
                            <div class="review-card" onclick="openReviewModal('images/review-5.jpg')"><div class="review-img-wrap"><img src="images/review-5.jpg" loading="lazy"></div></div>
                        </div>
                    </div>
                </section>

                <!-- FINAL CLOSING -->
                <section class="final-closing-section">
                    <h1 class="oversize-brand">ZORO.FINDS</h1>
                    <p class="closing-sub">RARE FINDS. ONE-OF-ONE. BUILT TO BE WORN.</p>
                    <div class="hero-actions-row cinematic-actions">
                        <button type="button" class="hero-cta-btn modern-btn" onclick="goToCollection('JACKETS')">SHOP JACKETS</button>
                        <button type="button" class="hero-cta-btn secondary modern-btn" onclick="goToCollection('HOODIES')">SHOP HOODIES</button>
                    </div>
                </section>
            </div>
        \;

        // Boot animations
        setTimeout(() => {
            const marquee = document.getElementById('marqueeTrack');
            const reveals = document.querySelectorAll('.reveal-text');
            const compBg = document.querySelector('.comp-bg');
            const compFg1 = document.querySelector('.comp-fg-1');
            const compFg2 = document.querySelector('.comp-fg-2');
            
            window.addEventListener('scroll', () => {
                const scrollY = window.scrollY;
                if (marquee) marquee.style.transform = \	ranslateX(-\ + (scrollY * 0.15) + \px)\;
                if (compBg) compBg.style.transform = \	ranslateY(\ + (scrollY * 0.1) + \px)\;
                if (compFg1) compFg1.style.transform = \	ranslateY(-\ + (scrollY * 0.05) + \px)\;
                if (compFg2) compFg2.style.transform = \	ranslateY(-\ + (scrollY * 0.15) + \px)\;
                
                reveals.forEach(el => {
                    const rect = el.getBoundingClientRect();
                    if (rect.top < window.innerHeight * 0.85) el.classList.add('visible');
                });
            }, { passive: true });
            
            window.dispatchEvent(new Event('scroll'));
            updateCartBadges(); // To update the top nav badge
        }, 100);

        requestAnimationFrame(initHeroCharacter);
    }
