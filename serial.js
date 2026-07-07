// --- Cookie helpers (simple key=value, no ; in values) ---
function setCookie(name, value, days) {
    const d = new Date();
    d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));
    const expires = "expires=" + d.toUTCString();
    document.cookie = name + "=" + encodeURIComponent(value) + ";" + expires + ";path=/";
}

function getCookie(name) {
    const cname = name + "=";
    const decoded = decodeURIComponent(document.cookie);
    const ca = decoded.split(';');
    for (let c of ca) {
        c = c.trim();
        if (c.indexOf(cname) === 0) {
            return c.substring(cname.length, c.length);
        }
    }
    return null;
}

// --- DOM elements ---
const connectBtn = document.getElementById('connect-btn');
const connectionStatus = document.getElementById('connection-status');
const sendSettingsBtn = document.getElementById('send-settings-btn');

const outputSlider = document.getElementById('output-slider');
const outputValue = document.getElementById('output-value');
const vendSlider = document.getElementById('vend-slider');
const vendValue = document.getElementById('vend-value');

const statusIcon = document.getElementById('status-icon');
const statusText = document.getElementById('status-text');

const outputProgressContainer = document.getElementById('output-progress-container');
const outputProgressSeconds = document.getElementById('output-progress-seconds');
const outputProgressTotal = document.getElementById('output-progress-total');
const outputProgressFill = document.getElementById('output-progress-fill');

const vendingCountEl = document.getElementById('vending-count');
const vendingChartCanvas = document.getElementById('vending-chart');
const serialMonitor = document.getElementById('serial-monitor');

const infoBtn = document.getElementById("info-btn");
const infoCover = document.getElementById("info-cover");
const closeCover = document.getElementById("close-cover");

// --- Serial state ---
let port = null;
let reader = null;
let writer = null;
let readLoopRunning = false;

// --- App state ---
let currentStatus = 'unknown';
let currentOutputSeconds = parseInt(outputSlider.value, 10);
let vendingCount = 0;
// distribution[outputSeconds] = count
let vendingDistribution = new Array(11).fill(0); // index 1..10 used

// --- Output progress timer ---
let outputTimerId = null;
let outputTimerStart = null;

function logSerial(direction, text) {
    const div = document.createElement('div');
    if (direction === 'out') {
        div.className = 'log-out';
        div.textContent = '>> ' + text;
    } else if (direction === 'in') {
        div.className = 'log-in';
        div.textContent = '<< ' + text;
    } else {
        div.className = 'log-info';
        div.textContent = text;
    }
    serialMonitor.appendChild(div);
    serialMonitor.scrollTop = serialMonitor.scrollHeight;
}

function setStatus(status) {
    currentStatus = status;
    statusText.textContent = status;
    // Map status to icon + color
    let iconClass = 'mdi-help-circle-outline';
    let color = '#616161';

    switch (status) {
        case 'standby':
            iconClass = 'mdi-pause-circle-outline';
            color = '#546e7a';
            break;
        case 'output':
            iconClass = 'mdi-play-circle-outline';
            color = '#43a047';
            break;
        case 'vending':
            iconClass = 'mdi-cart-outline';
            color = '#fb8c00';
            break;
        case 'incomplete':
            iconClass = 'mdi-alert-circle-outline';
            color = '#f4511e';
            break;
        case 'invalid':
            iconClass = 'mdi-close-circle-outline';
            color = '#e53935';
            break;
        default:
            iconClass = 'mdi-help-circle-outline';
            color = '#616161';
    }
    statusIcon.className = 'mdi ' + iconClass;
    statusIcon.style.color = color;
}

function startOutputProgress() {
    clearOutputProgress();
    outputProgressContainer.style.display = 'block';
    outputProgressTotal.textContent = String(currentOutputSeconds);
    outputProgressSeconds.textContent = '0';
    outputProgressFill.style.width = '0%';
    outputTimerStart = Date.now();
    outputTimerId = setInterval(() => {
        const elapsedSec = Math.floor((Date.now() - outputTimerStart) / 1000);
        const clamped = Math.min(elapsedSec, currentOutputSeconds);
        outputProgressSeconds.textContent = String(clamped);
        const pct = currentOutputSeconds > 0 ? (clamped / currentOutputSeconds) * 100 : 0;
        outputProgressFill.style.width = pct + '%';
    }, 250);
}

function clearOutputProgress() {
    if (outputTimerId !== null) {
        clearInterval(outputTimerId);
        outputTimerId = null;
    }
    outputProgressContainer.style.display = 'none';
    outputProgressSeconds.textContent = '0';
    outputProgressFill.style.width = '0%';
}

// --- Persistence (cookies) ---
function loadPersistence() {
    const countCookie = getCookie('vendingCount');
    if (countCookie !== null) {
        const n = parseInt(countCookie, 10);
        if (!Number.isNaN(n)) {
            vendingCount = n;
        }
    }
    const distCookie = getCookie('vendingDistribution');
    if (distCookie !== null) {
        try {
            const arr = JSON.parse(distCookie);
            if (Array.isArray(arr) && arr.length === 11) {
                vendingDistribution = arr.map(x => Number(x) || 0);
            }
        } catch (e) {
            // ignore
        }
    }
    updateVendingUI();
}

function savePersistence() {
    setCookie('vendingCount', String(vendingCount), 365);
    setCookie('vendingDistribution', JSON.stringify(vendingDistribution), 365);
}

// --- Chart drawing (simple bar chart) ---
function drawVendingChart() {
    const ctx = vendingChartCanvas.getContext('2d');
    const w = vendingChartCanvas.width;
    const h = vendingChartCanvas.height;
    ctx.clearRect(0, 0, w, h);

    const maxCount = Math.max(...vendingDistribution.slice(1));
    const padding = 24;
    const barWidth = (w - padding * 2) / 10 * 0.7;
    const step = (w - padding * 2) / 10;

    ctx.font = '10px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    // axes
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, h - padding);
    ctx.lineTo(w - padding, h - padding);
    ctx.stroke();

    if (maxCount === 0) {
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('No vending events yet', w / 2, h / 2);
        return;
    }

    for (let x = 1; x <= 10; x++) {
        const count = vendingDistribution[x];
        const xCenter = padding + (x - 0.5) * step;
        const barHeight = (count / maxCount) * (h - padding * 2 - 10);
        const xLeft = xCenter - barWidth / 2;
        const yTop = (h - padding) - barHeight;

        // bar
        ctx.fillStyle = '#42a5f5';
        ctx.fillRect(xLeft, yTop, barWidth, barHeight);

        // label (x)
        ctx.fillStyle = '#ffffff';
        ctx.textBaseline = 'top';
        ctx.fillText(String(x), xCenter, h - padding + 4);

        // value
        ctx.textBaseline = 'bottom';
        ctx.fillText(String(count), xCenter, yTop - 2);
    }
}

function updateVendingUI() {
    vendingCountEl.textContent = String(vendingCount);
    drawVendingChart();
}

// --- Serial helpers ---
async function connectSerial() {
    if (!('serial' in navigator)) {
        alert('Web Serial API not supported in this browser.');
        return;
    }
    try {
        port = await navigator.serial.requestPort();
        await port.open({ baudRate: 9600 }); // adjust if needed
        connectionStatus.textContent = 'Connected';
        connectBtn.textContent = 'Disconnect';
        sendSettingsBtn.disabled = false;

        const textEncoder = new TextEncoderStream();
        const textDecoder = new TextDecoderStream();
        textEncoder.readable.pipeTo(port.writable);
        port.readable.pipeTo(textDecoder.writable);

        writer = textEncoder.writable.getWriter();
        reader = textDecoder.readable.getReader();

        readLoopRunning = true;
        readLoop();
        logSerial('info', 'Connected to Pain Machine.');
    } catch (err) {
        console.error(err);
        alert('Failed to open serial port: ' + err);
    }
}

async function disconnectSerial() {
    readLoopRunning = false;
    try {
        if (reader) {
            await reader.cancel();
            reader.releaseLock();
        }
    } catch (e) { }
    try {
        if (writer) {
            await writer.close();
            writer.releaseLock();
        }
    } catch (e) { }
    try {
        if (port) {
            await port.close();
        }
    } catch (e) { }
    port = null;
    reader = null;
    writer = null;
    connectionStatus.textContent = 'Not connected';
    connectBtn.textContent = 'Connect';
    sendSettingsBtn.disabled = true;
    logSerial('info', 'Disconnected.');
}

async function writeLine(line) {
    if (!writer) return;
    const text = line.endsWith('\n') ? line : line + '\n';
    await writer.write(text);
    logSerial('out', text.trimEnd());
}

async function readLoop() {
    let buffer = '';
    while (readLoopRunning && reader) {
        try {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) {
                buffer += value;
                // split into lines
                let idx;
                while ((idx = buffer.indexOf('\n')) >= 0) {
                    const line = buffer.slice(0, idx).replace(/\r$/, '');
                    buffer = buffer.slice(idx + 1);
                    handleIncomingLine(line);
                }
            }
        } catch (err) {
            console.error('Read error', err);
            break;
        }
    }
}

function handleIncomingLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    logSerial('in', trimmed);

    // Parse known messages: "vend x", "output x", "status x"
    const parts = trimmed.split(/\s+/);
    const cmd = parts[0].toLowerCase();

    if (cmd === 'vend' && parts.length === 2) {
        const v = parseInt(parts[1], 10);
        if (!Number.isNaN(v)) {
            // confirmation of vend command; nothing special for UI
        }
        return;
    }

    if (cmd === 'output' && parts.length === 2) {
        const v = parseInt(parts[1], 10);
        if (!Number.isNaN(v)) {
            // confirmation of output command; update current output seconds
            currentOutputSeconds = v;
        }
        return;
    }

    if (cmd === 'status' && parts.length >= 2) {
        const statusVal = parts[1].toLowerCase();
        setStatus(statusVal);

        if (statusVal === 'output') {
            startOutputProgress();
        } else {
            // any other status hides progress bar
            clearOutputProgress();
        }

        if (statusVal === 'vending') {
            vendingCount += 1;
            const outVal = currentOutputSeconds;
            if (outVal >= 1 && outVal <= 10) {
                vendingDistribution[outVal] += 1;
            }
            updateVendingUI();
            savePersistence();
        }
        return;
    }

    // Any other text: ignored for logic, but already logged in monitor.
}

function updateSliderValuePosition(slider, valueEl) {
    const min = slider.min;
    const max = slider.max;
    const val = slider.value;
    const correctionFactor = 13;

    const percent = (val - min) / (max - min);
    const sliderWidth = slider.offsetWidth;

    const thumbOffset = correctionFactor + percent * (sliderWidth - 2 * correctionFactor);

    valueEl.style.left = thumbOffset + "px";
    valueEl.textContent = val;
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// --- UI events ---
outputSlider.addEventListener('input', () => {
    outputValue.textContent = outputSlider.value;
    currentOutputSeconds = parseInt(outputSlider.value, 10);
    updateSliderValuePosition(outputSlider, outputValue);
});


vendSlider.addEventListener('input', () => {
    vendValue.textContent = vendSlider.value;
    updateSliderValuePosition(vendSlider, vendValue);
});

connectBtn.addEventListener('click', async () => {
    if (port) {
        await disconnectSerial();
    } else {
        await connectSerial();
    }
});

sendSettingsBtn.addEventListener('click', async () => {
    const vend = parseInt(vendSlider.value, 10);
    const out = parseInt(outputSlider.value, 10);
    if (!port || !writer) {
        alert('Not connected to a serial device.');
        return;
    }
    await writeLine(`vend ${vend}`);
    await new Promise(r => setTimeout(r, 3000));
    await writeLine(`pain ${out}`);
});

// --- Init ---
loadPersistence();
drawVendingChart();
setStatus('standby');
updateSliderValuePosition(outputSlider, outputValue);
updateSliderValuePosition(vendSlider, vendValue);
infoBtn.onclick = () => infoCover.style.display = "flex";
closeCover.onclick = () => infoCover.style.display = "none";
hljs.highlightAll();