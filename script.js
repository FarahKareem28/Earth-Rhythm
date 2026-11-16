const lightbox = document.querySelector("#lightbox");
const lightboxImage = document.querySelector("#lightboxImage");
const closeButton = document.querySelector("#closeLightbox");
const lightboxTitle = document.querySelector("#lightboxTitle");

const audio = document.querySelector("#sonificationAudio");
const playButton = document.querySelector("#playSonification");

document.querySelectorAll(".image").forEach((image) => {

    image.addEventListener("click", () => {

        const img = image.querySelector("img");

        if (!img || !lightbox || !lightboxImage) return;

        let imageSrc = image.dataset.image || img.src;

        if (img.src.includes("co2")) {
            imageSrc = "images/photo_6039406553363846594_y.jpg";
        } else if (img.src.includes("photo")) {
            imageSrc = "images/nightlights.png";
        }

        lightboxImage.src = imageSrc;

        if (lightboxTitle) {
            lightboxTitle.textContent = img.alt || "Earth Visualization";
        }

        if (audio) {
            audio.pause();
            audio.currentTime = 0;
            audio.src = image.dataset.audio || "";
            audio.load();
        }

        if (playButton) {
            playButton.disabled = !image.dataset.audio;
        }

        lightbox.showModal();
    });

});

function closeLightbox() {
    lightbox.close();
    stopVisualization();
}

closeButton.addEventListener("click", closeLightbox);

lightbox.addEventListener("click", (event) => {
    if (event.target === lightbox) {
        closeLightbox();
    }
});

const canvas = document.querySelector("#visualizer");
const ctx = canvas.getContext("2d");

let audioContext;
let analyser;
let source;
let animationId;

function setupAudio() {

    if (audioContext) return;

    audioContext = new (window.AudioContext || window.webkitAudioContext)();

    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;

    source = audioContext.createMediaElementSource(audio);

    source.connect(analyser);
    analyser.connect(audioContext.destination);
}

function visualize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;

    if (!width || !height) return;

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const bufferLength = analyser.frequencyBinCount;
    const audioData = new Uint8Array(bufferLength);

    // نجهّز نسخة صغيرة من الصورة لتحليل الإضاءة والتفاصيل بسرعة.
    const imageCanvas = document.createElement("canvas");
    const imageCtx = imageCanvas.getContext("2d", { willReadFrequently: true });
    const sampleWidth = Math.max(2, Math.round(width));
    const sampleHeight = Math.max(2, Math.round(height));

    imageCanvas.width = sampleWidth;
    imageCanvas.height = sampleHeight;

    let imagePixels = null;

    function readImagePixels() {
        if (!lightboxImage.complete || !lightboxImage.naturalWidth) return;

        try {
            imageCtx.clearRect(0, 0, sampleWidth, sampleHeight);
            imageCtx.drawImage(lightboxImage, 0, 0, sampleWidth, sampleHeight);
            imagePixels = imageCtx.getImageData(
                0, 0, sampleWidth, sampleHeight
            ).data;
        } catch (error) {
            // لو الصورة من مصدر يمنع قراءة pixels، نكمل بتأثير الصوت فقط.
            console.warn("Could not analyze image pixels:", error);
            imagePixels = null;
        }
    }

    readImagePixels();

    function getLuminance(x, y) {
        if (!imagePixels) return 0.5;

        const px = Math.max(0, Math.min(sampleWidth - 1, Math.round(x)));
        const py = Math.max(0, Math.min(sampleHeight - 1, Math.round(y)));
        const index = (py * sampleWidth + px) * 4;

        const r = imagePixels[index];
        const g = imagePixels[index + 1];
        const b = imagePixels[index + 2];

        // إدراك الإضاءة بطريقة أقرب للعين.
        return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    }

    function average(values) {
        return values.length
            ? values.reduce((sum, value) => sum + value, 0) / values.length
            : 0;
    }

    function draw() {
        if (audio.paused || audio.ended) return;

        animationId = requestAnimationFrame(draw);
        analyser.getByteFrequencyData(audioData);
        ctx.clearRect(0, 0, width, height);

        const duration = Number.isFinite(audio.duration) && audio.duration > 0
            ? audio.duration
            : 1;

        const progress = Math.min(1, audio.currentTime / duration);
        const scanX = progress * width;

        const bassLevel = average(Array.from(audioData.slice(0, 10))) / 255;
        const midLevel = average(Array.from(audioData.slice(10, 35))) / 255;
        const highLevel = average(Array.from(audioData.slice(35))) / 255;
        const audioStrength = bassLevel * 0.25 + midLevel * 0.45 + highLevel * 0.30;

        // نحدّث قراءة الصورة عند كل إطار حتى يظل المسح مرتبطًا بمكان الخط.
        if (!imagePixels && lightboxImage.complete) readImagePixels();

        const points = [];
        const step = 2;
        const maxImageBend = Math.min(width * 0.10, 42);

        for (let y = 0; y <= height; y += step) {
            const imageX = Math.max(1, Math.min(sampleWidth - 2, scanX));

            // قراءة الإضاءة حول موضع المسح الحالي في الصورة.
            const centerLight = getLuminance(imageX, y);
            const leftLight = getLuminance(imageX - 3, y);
            const rightLight = getLuminance(imageX + 3, y);
            const upperLight = getLuminance(imageX, y - 3);
            const lowerLight = getLuminance(imageX, y + 3);

            // التباين المحلي يكشف حدود الأجسام والتفاصيل، وليس الإضاءة وحدها.
            const horizontalEdge = rightLight - leftLight;
            const verticalEdge = lowerLight - upperLight;
            const edgeStrength = Math.min(
                1,
                Math.abs(horizontalEdge) * 2.2 +
                Math.abs(verticalEdge) * 1.4
            );

            // المناطق المضيئة والداكنة تؤثر في اتجاه ومقدار الانحناء.
            const brightnessOffset = (centerLight - 0.5) * 2;
            const imageInfluence =
                brightnessOffset * 0.55 +
                horizontalEdge * 2.0 +
                verticalEdge * 1.25;

            // الصوت يضيف حركة صغيرة فوق شكل الصورة بدل ما يفرض موجة مستقلة.
            const frequencyIndex = Math.min(
                bufferLength - 1,
                Math.floor((y / height) * bufferLength)
            );
            const localAudio = audioData[frequencyIndex] / 255;
            const audioRipple =
                Math.sin(y * 0.025 + audio.currentTime * 3.2) *
                localAudio * audioStrength * 0.22;

            const displacement =
                imageInfluence * maxImageBend +
                audioRipple * maxImageBend;

            points.push({
                x: scanX + displacement,
                y,
                edgeStrength,
                brightness: centerLight
            });
        }

        if (points.length < 2) return;

        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);

        // منحنيات ناعمة بين نقاط التحليل حتى يتبع الخط شكل الصورة بسلاسة.
        for (let i = 1; i < points.length - 1; i++) {
            const current = points[i];
            const next = points[i + 1];

            const midX = (current.x + next.x) / 2;
            const midY = (current.y + next.y) / 2;

            ctx.quadraticCurveTo(current.x, current.y, midX, midY);
        }

        const last = points[points.length - 1];
        ctx.lineTo(last.x, last.y);

        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.25 + bassLevel * 1.8;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.shadowBlur = 4 + highLevel * 10;
        ctx.shadowColor = "#ffffff";
        ctx.stroke();
        ctx.shadowBlur = 0;

        // ومضات خفيفة عند حدود التفاصيل الواضحة في الصورة.
        points.forEach((point, index) => {
            if (index % 5 !== 0 || point.edgeStrength < 0.38) return;

            ctx.beginPath();
            ctx.arc(point.x, point.y, 0.8 + point.edgeStrength * 1.2, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255,255,255,${0.18 + point.edgeStrength * 0.35})`;
            ctx.fill();
        });
    }

    draw();
}

playButton.addEventListener("click", async () => {

    if (!audio.src) return;

    setupAudio();

    await audioContext.resume();

    if (audio.paused) {

        try {
            await audio.play();

            cancelAnimationFrame(animationId);

            visualize();

        } catch (error) {
            console.error("Audio playback failed:", error);
        }

    } else {
        audio.pause();
        cancelAnimationFrame(animationId);
    }
});

function stopVisualization() {

    if (audio) {
        audio.pause();
        audio.currentTime = 0;
    }

    cancelAnimationFrame(animationId);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

audio.addEventListener("ended", () => {

    cancelAnimationFrame(animationId);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

});
