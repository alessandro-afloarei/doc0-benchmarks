# Files

- [IPC routing and message ports](ipc.md) - Renderer-to-main transport, frame and WebContents dispatch priority, invoke errors, synchronous replies, and transferred MessagePort ownership.
- [Node embedding, utility processes, and ASAR](node-and-asar.md) - How Electron cooperates with the Node event loop, hosts utility-process JavaScript, and makes ASAR paths available to selected filesystem and module operations.
- [Renderer sandbox, preloads, and context bridge](renderer-isolation.md) - Distinct renderer privilege controls, browser-mediated preload selection, sandboxed and Node-backed loading, and cross-world API conversion.
- [Sessions, storage, permissions, and networking](sessions-and-networking.md) - BrowserContext and Session identity, persistent partitions, Chromium-backed requests, custom protocol dispatch, and permission policy ownership.
- [Windows, WebContents, and guest lifecycles](windows-and-web-contents.md) - Ownership of native windows and page contents, navigation promises, close handling, child-window policy, and webview attachment boundaries.
