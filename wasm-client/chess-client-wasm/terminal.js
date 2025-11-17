// FILE: terminal.js
const term = new Terminal({
    cursorBlink: true,
    convertEol: true,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    fontSize: 14,
    theme: {
        background: '#1a1b26',
        foreground: '#a9b1d6',
        cursor: '#a9b1d6',
        selection: 'rgba(169, 177, 214, 0.3)'
    },
    cols: 120,
    rows: 40
});

term.open(document.getElementById('terminal'));
term.focus();

let inputBuffer = '';
let inputResolver = null;

term.onData(data => {
    if (inputResolver) {
        if (data === '\r') {
            term.write('\r\n');
            const result = inputBuffer;
            inputBuffer = '';
            const resolver = inputResolver;
            inputResolver = null;
            resolver(result);
        } else if (data === '\x7f' || data === '\x08') {
            if (inputBuffer.length > 0) {
                inputBuffer = inputBuffer.slice(0, -1);
                term.write('\b \b');
            }
        } else if (data === '\x03') {
            term.write('^C\r\n');
            inputBuffer = '';
            if (inputResolver) {
                inputResolver('');
                inputResolver = null;
            }
        } else if (data >= ' ' && data <= '~') {
            inputBuffer += data;
            term.write(data);
        }
    }
});

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// FIXED: Override GLOBAL fs, not go.fs
if (!globalThis.fs) {
    globalThis.fs = {};
}

// Store original methods if they exist
const originalWrite = globalThis.fs.write;
const originalRead = globalThis.fs.read;

globalThis.fs.write = function(fd, buf, offset, length, position, callback) {
    if (fd === 1 || fd === 2) {  // stdout/stderr
        const text = decoder.decode(buf.slice(offset, offset + length));
        term.write(text);
        callback(null, length);
    } else if (originalWrite) {
        originalWrite.call(this, fd, buf, offset, length, position, callback);
    } else {
        callback(new Error('Invalid fd'));
    }
};

globalThis.fs.read = function(fd, buf, offset, length, position, callback) {
    if (fd === 0) {  // stdin
        const promise = new Promise(resolve => {
            inputResolver = resolve;
        });

        promise.then(line => {
            const input = encoder.encode(line + '\n');
            const n = Math.min(length, input.length);
            buf.set(input.slice(0, n), offset);
            callback(null, n);
        });
    } else if (originalRead) {
        originalRead.call(this, fd, buf, offset, length, position, callback);
    } else {
        callback(new Error('Invalid fd'));
    }
};

// Create Go runtime AFTER fs override
const go = new Go();

WebAssembly.instantiateStreaming(fetch('chess-client.wasm'), go.importObject)
    .then(result => {
        go.run(result.instance);
    })
    .catch(err => {
        term.writeln('\r\n\x1b[31mError loading WASM: ' + err + '\x1b[0m');
        console.error('WASM load error:', err);
    });

// Fit terminal to container size
function fitTerminal() {
    const container = document.getElementById('terminal');
    if (!container) return;

    // Get actual container dimensions
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;

    // Calculate character dimensions based on fontSize (14px)
    // For monospace fonts: width ≈ fontSize * 0.6, height ≈ fontSize * 1.2
    const charWidth = 14 * 0.6;   // ~8.4px
    const charHeight = 14 * 1.2;  // ~16.8px

    const cols = Math.floor(containerWidth / charWidth);
    const rows = Math.floor(containerHeight / charHeight);

    // Only resize if dimensions are valid
    if (cols > 0 && rows > 0) {
        term.resize(cols, rows);
    }
}

// Debounce resize events to avoid excessive recalculations
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(fitTerminal, 100);
});

// Fit terminal initially after a short delay (allow DOM to settle)
setTimeout(fitTerminal, 100);