export default {
    async fetch(request, env) {
        const url = new URL(request.url);
  
        const r2Bindings = Object.entries(env).filter(([_, binding]) => binding.list);
        if (!r2Bindings.length) {
            return new Response('No R2 buckets found', { status: 500 });
        }
  
        if (url.pathname.startsWith('/files/')) {
            return await serveFile(url.pathname, env, r2Bindings);
        }
  
        if (url.pathname === '/buckets') {
            const start = parseInt(url.searchParams.get('start') || '0');
            const limit = parseInt(url.searchParams.get('limit') || '10');
            return new Response(await generateBucketChunk(r2Bindings, start, limit), {
                headers: { 'Content-Type': 'text/html' },
            });
        }
  
        return new Response(await generateHTML(r2Bindings), {
            headers: { 'Content-Type': 'text/html' },
        });
    }
  };
  
  async function serveFile(path, env, r2Bindings) {
    const filePath = path.replace('/files/', '');
    const [bucketName, ...restPath] = filePath.split('/');
    const actualPath = restPath.join('/');
  
    const binding = r2Bindings.find(([name]) => name === bucketName)?.[1];
    if (!binding) return new Response('Bucket not found', { status: 404 });
  
    const file = await binding.get(actualPath);
    if (!file) return new Response('File not found', { status: 404 });
  
    const contentType = detectContentType(actualPath);
    return new Response(file.body, {
        headers: {
            'Cache-Control': 'public, max-age=31536000',
            'Content-Type': contentType
        }
    });
  }
  
  async function generateBucketChunk(r2Bindings, start, limit) {
    let html = '';
    const slice = r2Bindings.slice(start, start + limit);  // Slice the list for pagination
  
    for (const [bucketName, binding] of slice) {
        const bucketId = `bucket-${bucketName.replace(/[^\w-]/g, "_")}`;
        html += `
            <div class="bucket-box">
                <label>
                    <input type="checkbox" onclick="toggleVisibility('${bucketId}', 'block')">
                    <strong>${bucketName}</strong>
                </label>
                <div id="${bucketId}" class="folder-list">`;
  
        const folders = await getFolderStructure(binding);
  
        for (const folder in folders) {
            const folderId = `${bucketName}-${folder}`.replace(/[^\w-]/g, "_");
            const arrayId = `${bucketName}-${folder}-array`;
            html += `
                <div>
                    <label>
                        <input type="checkbox" onclick="toggleArrayVisibility('${arrayId}')">
                        ${folder}
                    </label>
                    <ul id="${folderId}" class="file-list">`;
  
            let jsArrayText = `${bucketName} - ${folder} = [\n`;
  
            for (const file of folders[folder]) {
                const fileLink = `https://cached-file-link.jhondumanhog.workers.dev/files/${bucketName}/${file}`;
                const fileNameWithoutFolderAndExtension = file
                    .replace(/^.*\//, '')
                    .replace(/_/g, ' ')
                    .replace(/\.[^/.]+$/, '');
  
                html += `<li><a href="${fileLink}" target="_blank">${file}</a></li>`;
                jsArrayText += `  { img: "${fileLink}", name: "${fileNameWithoutFolderAndExtension}" },\n`;
            }
  
            jsArrayText = jsArrayText.trim().slice(0, -1);
            jsArrayText += `\n];\n\n`;
  
            html += `</ul>
                    <div id="${arrayId}" class="array-output">${jsArrayText}</div>
                </div>`;
        }
  
        html += `</div></div>`;
    }
  
    return html;
  }
  
  async function generateHTML(r2Bindings) {
    let html = `<!DOCTYPE html>
    <html>
    <head>
        <title>R2 Buckets</title>
        <style>
            body {
                font-family: sans-serif;
                white-space: pre-wrap;
            }
            .bucket-list {
                display: block;
            }
            .bucket-box {
                border: 1px solid #ccc;
                padding: 10px;
                border-radius: 8px;
                margin-bottom: 15px;
            }
            .folder-list {
                margin-left: 15px;
                display: none;
            }
            .file-list {
                margin-left: 15px;
                display: none;
            }
            .array-output {
                margin-left: 15px;
                display: none;
                background-color: #f4f4f4;
                padding: 10px;
                border-radius: 5px;
                margin-top: 10px;
                white-space: pre-wrap;
            }
            #searchInput {
                margin-bottom: 20px;
                padding: 8px;
                width: 100%;
                max-width: 400px;
                font-size: 16px;
                border: 1px solid #aaa;
                border-radius: 6px;
            }
        </style>
        <script>
            function toggleVisibility(id, blockType = "block") {
                const el = document.getElementById(id);
                if (!el) return;
                el.style.display = (el.style.display === "none" || el.style.display === "") ? blockType : "none";
            }
  
            function toggleArrayVisibility(id) {
                const arrayDiv = document.getElementById(id);
                arrayDiv.style.display = (arrayDiv.style.display === "none" || arrayDiv.style.display === "") ? "block" : "none";
            }
  
            function filterBuckets() {
                const input = document.getElementById('searchInput').value.toLowerCase();
                const buckets = document.getElementsByClassName('bucket-box');
                for (const bucket of buckets) {
                    const bucketName = bucket.textContent.toLowerCase();
                    bucket.style.display = bucketName.includes(input) ? 'block' : 'none';
                }
            }
  
            // Lazy loading code
            let start = 0;
            const limit = 5;
  
            async function loadMore() {
                const res = await fetch(\`/buckets?start=\${start}&limit=\${limit}\`);
                const html = await res.text();
                document.getElementById("bucketList").insertAdjacentHTML('beforeend', html);
                start += limit;
            }
  
            window.addEventListener('scroll', () => {
                const { scrollTop, scrollHeight, clientHeight } = document.documentElement;
                if (scrollTop + clientHeight >= scrollHeight - 50) {
                    loadMore();
                }
            });
  
            loadMore();  // Initial load
        </script>
    </head>
    <body>
        <h1>File Links</h1>
        <input type="text" id="searchInput" onkeyup="filterBuckets()" placeholder="Search school name...">
        <div class="bucket-list" id="bucketList"></div>
        <div id="loading">Loading more...</div>
    </body>
    </html>`;
    return html;
  }
  
  async function getFolderStructure(binding) {
    const folderMap = {};
    const list = await binding.list({ prefix: "", delimiter: "/" });
  
    for (const prefix of list.delimitedPrefixes || []) {
        const folderName = prefix.replace(/\/$/, '');
        const folderList = await binding.list({ prefix });
        folderMap[folderName] = folderList.objects.map(obj => obj.key);
    }
  
    return folderMap;
  }
  
  function detectContentType(path) {
    return path.endsWith('.mp4') ? 'video/mp4' :
           path.endsWith('.webm') ? 'video/webm' :
           path.endsWith('.ogg') ? 'video/ogg' :
           path.endsWith('.jpg') || path.endsWith('.jpeg') ? 'image/jpeg' :
           path.endsWith('.png') ? 'image/png' : 'application/octet-stream';
  }
  