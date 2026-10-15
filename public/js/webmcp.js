(function () {
  var tools = [{"name":"get_profile","description":"Returns professional profile: name, title, location, experience, expertise, and social links for Jonathan Lloyd.","inputSchema":{"type":"object","properties":{}},"annotations":{"readOnlyHint":true}},{"name":"get_data_sources","description":"Returns the public data sources with descriptions and URLs. Health, sleep, and workouts point at llms-full.txt, which carries them only as coarsened bands.","inputSchema":{"type":"object","properties":{}},"annotations":{"readOnlyHint":true}},{"name":"get_current_reading","description":"Fetches the current bookshelf from the live API and returns books being read, up next, and recently finished.","inputSchema":{"type":"object","properties":{}},"annotations":{"readOnlyHint":true,"untrustedContentHint":true}},{"name":"get_tech_stack","description":"Returns the technology stack and architecture details of this portfolio site.","inputSchema":{"type":"object","properties":{}},"annotations":{"readOnlyHint":true}}];
  var version = "2026-07-28";
  function call(name, options) {
    return fetch("/mcp", {
      method: 'POST',
      signal: options && options.signal,
      headers: {'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': version, 'Mcp-Method': 'tools/call', 'Mcp-Name': name},
      body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name: name, arguments: {}, _meta: {'io.modelcontextprotocol/protocolVersion': version, 'io.modelcontextprotocol/clientInfo': {name: 'webmcp', version: "1.0.0"}, 'io.modelcontextprotocol/clientCapabilities': {}}}})
    }).then(function (res) { return res.json(); }).then(function (message) {
      if (message.error) { throw new Error(message.error.message); }
      var result = JSON.parse(message.result.content[0].text);
      if (message.result.isError) { throw new Error(JSON.stringify(result)); }
      return result;
    });
  }
  function register(modelContext) {
    tools.forEach(function (tool) {
      tool.execute = function (input, options) { return call(tool.name, options); };
      // One failed registration (a synchronous throw or a rejection) must not stop the rest.
      try { Promise.resolve(modelContext.registerTool(tool)).catch(function () {}); } catch (error) {}
    });
  }
  if (typeof document !== 'undefined' && document.modelContext && document.modelContext.registerTool) {
    register(document.modelContext);
  } else if (typeof navigator !== 'undefined' && navigator.modelContext && navigator.modelContext.registerTool) {
    register(navigator.modelContext);
  }
})();
