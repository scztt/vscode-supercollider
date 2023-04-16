document.on('load', () => {
    create_menubar_item("⇦", "#", (a, li) => {
        a.href = null;
        a.on("click", (e) => {
            e.preventDefault();
            history.back();
        })
    });
    create_menubar_item("⇨", "#", (a, li) => {
        a.href = null;
        a.on("click", (e) => {
            e.preventDefault();
            history.forward();
        })
    });

    document.querySelectorAll('a').forEach((a) => {
        if (a.href.startsWith("file://")) {
            a.addEventListener("click", function (e) {
                window.parent.postMessage({
                    command: "open_local_file",
                    href: a.href
                }, "*");
            });
        }
    });
});

window.addEventListener('message', (event) => {
    switch (event.data.command) {
        case 'init': {
            const styles = event.data.css;
            for (const [key, value] of Object.entries(styles)) {
                localStorage[key] = value;
                document.documentElement.style.setProperty(key, value);
            }
        }
    }
});

for (var i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.indexOf('--vscode') === -1) continue;

    const value = localStorage.getItem(key);
    document.documentElement.style.setProperty(key, value);
}

