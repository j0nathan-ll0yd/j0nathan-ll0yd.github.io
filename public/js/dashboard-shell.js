(function () {
  var resolveShell
  window.__dashboardShellReady = new Promise(function (resolve) {
    resolveShell = resolve
  })

  var shellUrl = new URL(window.location.href)
  shellUrl.searchParams.set('_dashboard_shell', '1')
  void fetch(shellUrl.href, {
    cache: 'no-store',
    headers: {'X-Dashboard-Client-Shell': '1'}
  }).then(function (response) {
    if (!response.ok) {
      resolveShell(false)
      return null
    }
    // Local Astro preview serves the fixture shell directly, so no replacement
    // is necessary. Production Pages marks the private bootstrap response.
    if (response.headers.get('X-Dashboard-Shell') !== 'fixture') {
      resolveShell(true)
      return null
    }
    return response.text()
  }).then(function (html) {
    if (html === null) return
    // Give DOMParser an explicit body context. A fragment-leading <template>
    // is otherwise reparented into <head>, separating it from the end marker.
    var parsed = new DOMParser().parseFromString('<!doctype html><html><body>' + html + '</body></html>', 'text/html')
    var sourceStart = parsed.getElementById('dashboard-live-start')
    var sourceEnd = parsed.getElementById('dashboard-live-end')
    var targetStart = document.getElementById('dashboard-live-start')
    var targetEnd = document.getElementById('dashboard-live-end')
    if (!sourceStart || !sourceEnd || !targetStart || !targetEnd || !targetEnd.parentNode) {
      resolveShell(false)
      return
    }

    var fragment = document.createDocumentFragment()
    var sourceNode = sourceStart.nextSibling
    while (sourceNode && sourceNode !== sourceEnd) {
      fragment.appendChild(document.importNode(sourceNode, true))
      sourceNode = sourceNode.nextSibling
    }

    var targetNode = targetStart.nextSibling
    while (targetNode && targetNode !== targetEnd) {
      var next = targetNode.nextSibling
      targetNode.parentNode.removeChild(targetNode)
      targetNode = next
    }
    targetEnd.parentNode.insertBefore(fragment, targetEnd)
    resolveShell(true)
  }).catch(function () {
    // Keep the truthful edge-composed snapshot in place. The client live-data
    // runtime observes false and does not try to mutate absent widget targets.
    resolveShell(false)
  })
})()
