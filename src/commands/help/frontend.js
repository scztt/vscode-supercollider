addEventListener("load", function (event) {
    let oldFixTOC = window.fixTOC;

    window.fixTOC = function () {
        oldFixTOC();

        if (window.location !== window.parent.location) {
            create_menubar_item("⇨", "#", (a, li) => {
                a.href = null;
                a.on("click", (e) => {
                    e.preventDefault();
                    history.forward();
                });

                li.detach();
                $("#nav").prepend(li);
            });
            create_menubar_item("⇦", "#", (a, li) => {
                a.href = null;
                a.on("click", (e) => {
                    e.preventDefault();
                    history.back();
                });

                li.detach();
                $("#nav").prepend(li);
            });
        }

        document.querySelectorAll('a').forEach((a) => {
            if (a.href.startsWith("file://")) {
                a.addEventListener("click", function (e) {
                    window.parent.postMessage({
                        command: "open-local-file",
                        href: a.href
                    }, "*");
                });
            }
        });
    }

    window.addEventListener('message', (event) => {
        switch (event.data.command) {
            case 'init': {
                const styles = event.data.css;
                for (const [key, value] of Object.entries(styles)) {
                    localStorage[key] = value;
                    document.documentElement.style.setProperty(key, value);
                }
            }
            case 'execCommand': {
                document.execCommand(event.data.data);
            }
        }
    });

    const rebroadcast = (type, e) => {
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
        }, "*");
    };
    window.addEventListener('keydown', (event) => rebroadcast('keydown', event));
    window.addEventListener('keyup', (event) => rebroadcast('keyup', event));
    window.addEventListener('keypress', (event) => rebroadcast('keypress', event));
    
    for (var i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.indexOf('--vscode') === -1) continue;

        const value = localStorage.getItem(key);
        document.documentElement.style.setProperty(key, value);
    }
});