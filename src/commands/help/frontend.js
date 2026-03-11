addEventListener("load", function (event) {
    // Notify parent of current path so webview state tracks navigation
    window.parent.postMessage({
        command: "navigate",
        path: location.pathname.replace(/^\/+/, '')
    }, "*");

    let oldFixTOC = window.fixTOC;

    // Hook fixTOC — runs on all SC help pages (class docs, Browse, Search)
    window.fixTOC = function () {
        oldFixTOC();

        if (window.location !== window.parent.location) {
            create_menubar_item(">", "#", function(a, li) {
                a.attr("href", null).addClass("vsc-nav-arrow");
                a.on("click", function(e) { e.preventDefault(); history.forward(); });
                li.addClass("vsc-nav-item").detach();
                $("#nav").prepend(li);
            });
            create_menubar_item("<", "#", function(a, li) {
                a.attr("href", null).addClass("vsc-nav-arrow");
                a.on("click", function(e) { e.preventDefault(); history.back(); });
                li.addClass("vsc-nav-item").detach();
                $("#nav").prepend(li);
            });
        }
    }

    // Hijack copy buttons in code views — clipboard API doesn't work in webviews.
    // Replace with "open in editor" arrow that sends code to VS Code as a new .scd document.
    document.querySelectorAll('.codeMirrorContainer').forEach(function(container) {
        var button = container.querySelector('.copy-button');
        var editor = container.querySelector('.editor');
        if (!button || !editor) return;

        // Replace icon with left arrow
        button.innerHTML = '<span style="font-size:16px; color: var(--color-cm-comment); display:block; width:20px; height:20px; line-height:20px; text-align:center;">\u21e6</span>';
        button.title = 'Open in editor';

        // Remove old listeners by cloning
        var newButton = button.cloneNode(true);
        button.parentNode.replaceChild(newButton, button);

        newButton.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            window.parent.postMessage({
                command: 'open-code',
                code: editor.value
            }, '*');
        });
    });

    // Intercept file:// links on all pages
    document.querySelectorAll('a').forEach((a) => {
        if (a.href && a.href.startsWith("file://")) {
            a.addEventListener("click", function (e) {
                e.preventDefault();
                window.parent.postMessage({
                    command: "open-local-file",
                    href: a.href
                }, "*");
            });
        }
    });

    // Pick the SC Doc theme whose code background is closest to the VS Code editor background
    function selectBestTheme(editorBg) {
        var themes = {
            'default':        '#ffffff',
            'classic':        '#ffffff',
            'solarizedLight': '#fdf6e3',
            'monokai':        '#272822',
            'dracula':        '#282a36',
            'solarizedDark':  '#002b36',
            'dark':           '#000000',
        };

        function parseHex(hex) {
            hex = hex.replace('#', '');
            if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
            return [parseInt(hex.slice(0,2),16), parseInt(hex.slice(2,4),16), parseInt(hex.slice(4,6),16)];
        }

        function parseColor(str) {
            str = (str || '').trim();
            if (str.startsWith('#')) return parseHex(str);
            var m = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
            if (m) return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
            return null;
        }

        function colorDist(a, b) {
            var dr = a[0]-b[0], dg = a[1]-b[1], db = a[2]-b[2];
            return dr*dr + dg*dg + db*db;
        }

        var target = parseColor(editorBg);
        if (!target) return null;

        var best = null, bestDist = Infinity;
        for (var name in themes) {
            var d = colorDist(target, parseHex(themes[name]));
            if (d < bestDist) { bestDist = d; best = name; }
        }
        return best;
    }

    var needsReload = !localStorage.getItem('--vscode-editor-background');

    window.addEventListener('message', (event) => {
        switch (event.data.command) {
            case 'init': {
                const styles = event.data.css;
                for (const [key, value] of Object.entries(styles)) {
                    localStorage[key] = value;
                    document.documentElement.style.setProperty(key, value);
                }
                // Pick SC theme closest to VS Code editor background
                var editorBg = styles['--vscode-editor-background'];
                var themeName = selectBestTheme(editorBg);
                if (themeName && typeof setTheme === 'function') {
                    setTheme(themeName);
                }
                // First load ever — localStorage was empty, so scdoc.js used wrong theme.
                // Reload now that localStorage is populated.
                if (needsReload) {
                    needsReload = false;
                    location.reload();
                    return;
                }
                break;
            }
            case 'execCommand': {
                document.execCommand(event.data.data);
                break;
            }
        }
    });

    // Rebroadcast keyboard events to the outer webview so VS Code can
    // handle shortcuts like Cmd+W (close panel) while the iframe has focus.
    var rebroadcast = function(type, e) {
        window.parent.postMessage({
            command: 'keyboard-rebroadcast',
            type: type,
            key: e.key,
            keyCode: e.keyCode,
            code: e.code,
            shiftKey: e.shiftKey,
            altKey: e.altKey,
            ctrlKey: e.ctrlKey,
            metaKey: e.metaKey,
            repeat: e.repeat
        }, '*');
    };
    window.addEventListener('keydown', function(e) { rebroadcast('keydown', e); });
    window.addEventListener('keyup', function(e) { rebroadcast('keyup', e); });

    for (var i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.indexOf('--vscode') === -1) continue;

        const value = localStorage.getItem(key);
        document.documentElement.style.setProperty(key, value);
    }

    // On load, apply the best SC theme from cached editor background.
    // This runs AFTER scdoc.js applyTheme() so it corrects the theme immediately
    // on the first page load, before the init message arrives.
    var cachedBg = localStorage.getItem('--vscode-editor-background');
    if (cachedBg) {
        var earlyTheme = selectBestTheme(cachedBg);
        if (earlyTheme && typeof setTheme === 'function') {
            setTheme(earlyTheme);
        }
    }
});