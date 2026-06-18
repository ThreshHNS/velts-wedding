document.addEventListener('DOMContentLoaded', () => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ---------- Scroll reveal ---------- */
    const reveal = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('revealed');
                reveal.unobserve(entry.target);
            }
        });
    }, { threshold: 0.15, rootMargin: '0px 0px -50px 0px' });
    document.querySelectorAll('[data-reveal]').forEach(el => reveal.observe(el));

    /* ---------- Corner ornaments ---------- */
    const cornerObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('revealed-corners');
                cornerObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1 });
    document.querySelectorAll('.location, .dresscode').forEach(el => cornerObserver.observe(el));

    /* ---------- Hero names: staggered entrance ---------- */
    document.querySelectorAll('[data-reveal-name]').forEach((el, i) => {
        setTimeout(() => el.classList.add('revealed'), 250 + i * 260);
    });

    /* ---------- Parallax ---------- */
    const parallaxEls = [...document.querySelectorAll('[data-parallax]')];
    if (parallaxEls.length && !reduceMotion) {
        let ticking = false;
        const update = () => {
            const vh = window.innerHeight;
            parallaxEls.forEach(el => {
                const rect = el.getBoundingClientRect();
                const speed = parseFloat(el.dataset.parallax) || 0.05;
                const offset = (rect.top + rect.height / 2 - vh / 2) * -speed;
                el.style.transform = `translate(0, ${offset.toFixed(1)}px)`;
            });
            ticking = false;
        };
        window.addEventListener('scroll', () => {
            if (!ticking) { requestAnimationFrame(update); ticking = true; }
        }, { passive: true });
        update();
    }

});
