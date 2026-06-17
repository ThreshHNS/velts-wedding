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

    /* ---------- Add to calendar (.ics download) ---------- */
    const calBtn = document.getElementById('calBtn');
    if (calBtn) {
        calBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const dt = (d) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
            const start = new Date('2026-08-20T15:30:00+03:00');
            const end = new Date('2026-08-20T23:00:00+03:00');
            const ics = [
                'BEGIN:VCALENDAR',
                'VERSION:2.0',
                'PRODID:-//velts-wedding//RU',
                'BEGIN:VEVENT',
                'UID:' + Date.now() + '@velts-wedding',
                'DTSTAMP:' + dt(new Date()),
                'DTSTART:' + dt(start),
                'DTEND:' + dt(end),
                'SUMMARY:Свадьба Екатерины и Андрея',
                'DESCRIPTION:С радостью приглашаем вас разделить с нами наш свадебный день!',
                'LOCATION:Особняк Балинского, Пироговская набережная 7, Санкт-Петербург',
                'END:VEVENT',
                'END:VCALENDAR'
            ].join('\r\n');
            const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'wedding-20-08-2026.ics';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
        });
    }

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

    /* ---------- Drifting petals ---------- */
    const canvas = document.querySelector('.petals');
    if (canvas && !reduceMotion) {
        const ctx = canvas.getContext('2d');
        const colors = ['#f6cbd5', '#e8d2e7', '#e5d2c4', '#cfdfef', '#f4eeb2'];
        let w, h, petals, raf;

        const resize = () => {
            w = canvas.width = window.innerWidth;
            h = canvas.height = window.innerHeight;
        };
        resize();
        window.addEventListener('resize', resize);

        const rnd = (a, b) => a + Math.random() * (b - a);

        function spawn(initial) {
            return {
                x: rnd(0, w),
                y: initial ? rnd(0, h) : rnd(-60, -10),
                r: rnd(8, 16),
                color: colors[(Math.random() * colors.length) | 0],
                sway: rnd(0.8, 2.0),
                swaySpeed: rnd(0.008, 0.022),
                vy: rnd(0.45, 1.05),
                rot: rnd(0, Math.PI * 2),
                vrot: rnd(-0.012, 0.012),
                flip: rnd(0, Math.PI * 2),
                flipSpeed: rnd(0.02, 0.05),
                phase: rnd(0, Math.PI * 2),
                alpha: rnd(0.55, 0.88),
            };
        }

        const count = window.innerWidth < 700 ? 22 : 42;
        petals = Array.from({ length: count }, () => spawn(true));

        function drawPetal(p) {
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            // horizontal "flip" to fake a petal tumbling in 3D
            ctx.scale(Math.cos(p.flip) * 0.7 + 0.35, 1);
            ctx.globalAlpha = p.alpha;
            ctx.fillStyle = p.color;
            const r = p.r;
            ctx.beginPath();
            ctx.moveTo(0, -r);
            ctx.bezierCurveTo(r * 0.95, -r * 0.55, r * 0.95, r * 0.55, 0, r);
            ctx.bezierCurveTo(-r * 0.95, r * 0.55, -r * 0.95, -r * 0.55, 0, -r);
            ctx.fill();
            ctx.restore();
        }

        function frame() {
            ctx.clearRect(0, 0, w, h);
            petals.forEach((p, i) => {
                p.phase += p.swaySpeed;
                p.flip += p.flipSpeed;
                p.x += Math.sin(p.phase) * p.sway;
                p.y += p.vy;
                p.rot += p.vrot;
                drawPetal(p);
                if (p.y > h + 24) petals[i] = spawn(false);
            });
            raf = requestAnimationFrame(frame);
        }
        frame();

        document.addEventListener('visibilitychange', () => {
            if (document.hidden) cancelAnimationFrame(raf);
            else frame();
        });
    }
});
