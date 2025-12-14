document.addEventListener('DOMContentLoaded', () => {

    // ==========================================
    // 1. INITIALIZATION & VARIABLES
    // ==========================================
    
    // Camera & Preview
    const video = document.getElementById('video-feed');
    const scannerContainer = document.getElementById('scanner-container');
    const previewContainer = document.getElementById('image-preview-container');
    const capturedImage = document.getElementById('captured-image');
    
    // Buttons
    const captureBtn = document.getElementById('btn-capture');
    const scanBarcodeBtn = document.getElementById('btn-scan-barcode');
    const toggleCameraBtn = document.getElementById('btn-toggle-camera');
    const saveLocalBtn = document.getElementById('btn-save-local');
    const uploadTrigger = document.getElementById('btn-upload-trigger');
    const fileInput = document.getElementById('file-input');
    const cancelEditBtn = document.getElementById('btn-cancel-edit');
    
    // Status & Data
    const cvStatus = document.getElementById('cv-status');
    const localDbBody = document.getElementById('local-db-body');
    
    // Inputs (Updated with new fields)
    const inputs = {
        accession: document.getElementById('accession-number'),
        date: document.getElementById('collection-date'),
        collector: document.getElementById('collector'),
        location: document.getElementById('location'),
        binomial: document.getElementById('binomial-input'),
        family: document.getElementById('family'),
        genus: document.getElementById('genus'),
        author: document.getElementById('author'),
        suggestions: document.getElementById('taxonomy-suggestions'),
        hint: document.getElementById('taxa-hint')
    };

    // State
    let html5QrCode; 
    let cropper; 
    let stream;
    let debounceTimer;
    let currentProcessedBlob = null; 
    let isEditMode = false;
    let editId = null; // ID of the specimen being edited
    let originalImageBase64 = null; // To keep old image if not replaced

    // ==========================================
    // 2. CAMERA MANAGEMENT
    // ==========================================
    async function startCamera() {
        try {
            stream = await navigator.mediaDevices.getUserMedia({ 
                video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } } 
            });
            video.srcObject = stream;
            video.style.display = 'block';
        } catch (err) { console.error("Camera Error:", err); }
    }
    startCamera();

    toggleCameraBtn.addEventListener('click', () => {
        if(stream) {
            stream.getTracks().forEach(track => track.stop());
            stream = null;
            toggleCameraBtn.textContent = "Start Camera";
        } else {
            startCamera();
            toggleCameraBtn.textContent = "Stop Camera";
        }
    });

    // ==========================================
    // 3. BARCODE SCANNER
    // ==========================================
    scanBarcodeBtn.addEventListener('click', () => {
        if(stream) { video.srcObject.getTracks().forEach(track => track.stop()); video.style.display = 'none'; }
        document.getElementById('scan-region-highlight').style.display = 'block';
        html5QrCode = new Html5Qrcode("scanner-container");
        
        html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 150 } }, 
        (decodedText) => {
            inputs.accession.value = decodedText;
            html5QrCode.stop().then(() => {
                document.getElementById('scan-region-highlight').style.display = 'none';
                video.style.display = 'block';
                startCamera(); 
            });
        }, (errorMessage) => {}).catch(err => console.log(err));
    });

    // ==========================================
    // 4. IMAGE CAPTURE & UPLOAD
    // ==========================================
    captureBtn.addEventListener('click', async () => {
        if (captureBtn.textContent.includes("Capture")) {
            if(!window.cvReady) { alert("AI Engine loading..."); return; }
            captureBtn.textContent = "Processing..."; captureBtn.disabled = true;

            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth; canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d'); ctx.drawImage(video, 0, 0);
            await processImageWithOpenCV(canvas);

        } else if (captureBtn.textContent.includes("Confirm")) {
            finishCrop();
        }
    });

    uploadTrigger.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            const reader = new FileReader();
            reader.onload = function(e) {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width; canvas.height = img.height;
                    const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
                    if(stream) { video.srcObject.getTracks().forEach(track => track.stop()); video.style.display = 'none'; }
                    if(!window.cvReady) { alert("AI loading..."); return; }
                    processImageWithOpenCV(canvas);
                };
                img.src = e.target.result;
            }
            reader.readAsDataURL(e.target.files[0]);
        }
    });

    // ==========================================
    // 5. OPENCV AUTO-STRAIGHTENING (FIXED)
    // ==========================================
    async function processImageWithOpenCV(sourceCanvas) {
        try {
            console.log("Starting OpenCV...");
            let src = cv.imread(sourceCanvas);
            let dst = new cv.Mat();
            let ksize = new cv.Size(5, 5);
            let dsize = new cv.Size(0, 0);
            let scale = 500 / src.cols; 
            cv.resize(src, dst, dsize, scale, scale, cv.INTER_AREA);

            cv.cvtColor(dst, dst, cv.COLOR_RGBA2GRAY, 0);
            cv.GaussianBlur(dst, dst, ksize, 0, 0, cv.BORDER_DEFAULT);
            cv.Canny(dst, dst, 75, 200);

            let contours = new cv.MatVector();
            let hierarchy = new cv.Mat();
            cv.findContours(dst, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

            let maxArea = 0; let maxCnt = null; let approx = new cv.Mat();
            for (let i = 0; i < contours.size(); ++i) {
                let cnt = contours.get(i);
                let area = cv.contourArea(cnt);
                if (area > 5000) { 
                    let peri = cv.arcLength(cnt, true);
                    cv.approxPolyDP(cnt, approx, 0.02 * peri, true);
                    if (approx.rows === 4 && area > maxArea) {
                        maxArea = area; maxCnt = approx.clone(); 
                    }
                }
            }

            const outputCanvas = document.createElement('canvas');
            if (maxCnt) {
                let inputPts = [];
                for(let i=0; i<4; i++) { inputPts.push(maxCnt.data32S[i*2] / scale); inputPts.push(maxCnt.data32S[i*2 + 1] / scale); }
                const orderedPts = orderPoints(inputPts);

                let widthA = Math.hypot(orderedPts[2] - orderedPts[0], orderedPts[3] - orderedPts[1]);
                let widthB = Math.hypot(orderedPts[6] - orderedPts[4], orderedPts[7] - orderedPts[5]);
                let maxWidth = Math.max(widthA, widthB);
                let heightA = Math.hypot(orderedPts[4] - orderedPts[0], orderedPts[5] - orderedPts[1]);
                let heightB = Math.hypot(orderedPts[6] - orderedPts[2], orderedPts[7] - orderedPts[3]);
                let maxHeight = Math.max(heightA, heightB);

                let srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, orderedPts);
                let dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, maxWidth, 0, maxWidth, maxHeight, 0, maxHeight]);
                let M = cv.getPerspectiveTransform(srcTri, dstTri);
                let warped = new cv.Mat();
                cv.warpPerspective(src, warped, M, new cv.Size(maxWidth, maxHeight), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

                cv.imshow(outputCanvas, warped); 
                capturedImage.src = outputCanvas.toDataURL('image/jpeg');
                
                srcTri.delete(); dstTri.delete(); M.delete(); warped.delete();
                cvStatus.textContent = "Auto-Straightened";
            } else {
                cv.imshow(outputCanvas, src);
                capturedImage.src = outputCanvas.toDataURL('image/jpeg');
                cvStatus.textContent = "Manual Mode";
            }

            src.delete(); dst.delete(); contours.delete(); hierarchy.delete(); 
            if(approx) approx.delete(); if(maxCnt) maxCnt.delete();

            video.style.display = 'none';
            scannerContainer.style.display = 'none';
            previewContainer.style.display = 'block';
            setTimeout(() => initCropper(), 100);

        } catch (e) {
            console.error("OpenCV Error:", e);
            alert("Error in AI processing. Reverting to basic capture.");
            capturedImage.src = sourceCanvas.toDataURL();
            initCropper();
        }
    }

    function orderPoints(pts) {
        let points = [{x: pts[0], y: pts[1]}, {x: pts[2], y: pts[3]}, {x: pts[4], y: pts[5]}, {x: pts[6], y: pts[7]}];
        points.sort((a,b) => a.y - b.y);
        let top = points.slice(0, 2).sort((a,b) => a.x - b.x); 
        let bottom = points.slice(2, 4).sort((a,b) => a.x - b.x);
        return [top[0].x, top[0].y, top[1].x, top[1].y, bottom[1].x, bottom[1].y, bottom[0].x, bottom[0].y];
    }

    function initCropper() {
        if(cropper) cropper.destroy();
        cropper = new Cropper(capturedImage, { viewMode: 1, autoCropArea: 0.9, movable: false, rotatable: true, zoomable: false });
        captureBtn.textContent = "✅ Confirm Crop"; captureBtn.classList.replace('btn-success', 'btn-warning'); captureBtn.disabled = false;
    }

    function finishCrop() {
        if(!cropper) return;
        cropper.getCroppedCanvas({ width: 1600 }).toBlob((blob) => {
            currentProcessedBlob = blob;
            captureBtn.textContent = `Ready (${(blob.size/1024).toFixed(0)} KB)`;
            captureBtn.classList.replace('btn-warning', 'btn-secondary');
            captureBtn.disabled = true; 
        }, 'image/jpeg', 0.7);
    }

    // ==========================================
    // 6. SMART TAXONOMY
    // ==========================================
    inputs.binomial.addEventListener('input', (e) => {
        const query = e.target.value; if (query.length < 3) return;
        clearTimeout(debounceTimer); debounceTimer = setTimeout(() => fetchSuggestions(query), 300);
    });

    inputs.binomial.addEventListener('change', (e) => {
        const selectedName = e.target.value; if(selectedName.length > 3) fetchExactDetails(selectedName);
    });

    async function fetchSuggestions(query) {
        const url = `https://api.gbif.org/v1/species/suggest?q=${query}&rank=SPECIES&datasetKey=d7dddbf4-2cf0-4f39-9b2a-bb099caae36c`;
        try {
            const response = await fetch(url); const data = await response.json();
            inputs.suggestions.innerHTML = ''; 
            data.forEach(item => {
                const option = document.createElement('option'); option.value = item.scientificName; inputs.suggestions.appendChild(option);
            });
        } catch (error) { console.error("GBIF Error:", error); }
    }

    async function fetchExactDetails(name) {
        const url = `https://api.gbif.org/v1/species/match?name=${encodeURIComponent(name)}&kingdom=Plantae`;
        try {
            inputs.hint.textContent = "Fetching details...";
            const response = await fetch(url); const data = await response.json();
            if (data.matchType !== 'NONE') {
                inputs.family.value = data.family || "Unknown"; inputs.genus.value = data.genus || "Unknown";
                inputs.author.value = data.authorship || (data.scientificName.includes(data.canonicalName) ? data.scientificName.replace(data.canonicalName, '').trim() : "");
                inputs.hint.innerHTML = `✅ Accepted: <b>${data.canonicalName}</b>`; inputs.hint.className = 'small text-success';
            } else {
                inputs.hint.textContent = "⚠️ Name not found in GBIF Backbone"; inputs.hint.className = 'small text-danger';
            }
        } catch (error) { inputs.hint.textContent = "Connection Error"; }
    }

    // ==========================================
    // 7. SAVE / UPDATE DATA (EDIT LOGIC)
    // ==========================================
    saveLocalBtn.addEventListener('click', () => {
        // Validation: Required Fields
        if (!inputs.accession.value || !inputs.binomial.value || !inputs.date.value || !inputs.collector.value || !inputs.location.value) { 
            alert("Please fill ALL mandatory fields (*)."); 
            return; 
        }

        // Logic to Handle Image:
        // 1. If New Image Captured -> Convert to Base64
        // 2. If No New Image BUT Edit Mode -> Use Old Base64
        // 3. If No New Image AND New Entry -> Error
        
        if (currentProcessedBlob) {
            const reader = new FileReader();
            reader.readAsDataURL(currentProcessedBlob);
            reader.onloadend = function() {
                saveToStorage(reader.result);
            }
        } else if (isEditMode && originalImageBase64) {
            saveToStorage(originalImageBase64); // Reuse existing image
        } else {
            alert("Please capture or upload an image.");
            return;
        }
    });

    function saveToStorage(base64Image) {
        const specimen = {
            id: inputs.accession.value,
            scientificName: inputs.binomial.value,
            family: inputs.family.value,
            author: inputs.author.value,
            genus: inputs.genus.value,
            date: inputs.date.value,           // New Field
            collector: inputs.collector.value, // New Field
            location: inputs.location.value,   // New Field
            image: base64Image,
            size: currentProcessedBlob ? (currentProcessedBlob.size / 1024).toFixed(1) + " KB" : "Unchanged"
        };

        try {
            let db = JSON.parse(localStorage.getItem('herbarium_db')) || [];

            if (isEditMode) {
                // UPDATE: Remove old entry with same ID and Add new
                db = db.filter(item => item.id !== editId);
                alert("Specimen Updated Successfully!");
            } else {
                // CREATE: Check for duplicates
                if(db.some(i => i.id === specimen.id)) {
                    alert("Error: Accession Number already exists!");
                    return;
                }
                alert("Saved Successfully!");
            }
            
            db.push(specimen);
            localStorage.setItem('herbarium_db', JSON.stringify(db));
            
            renderTable();
            resetApp();

        } catch (e) {
            console.error(e);
            alert("Storage Error. Data might be full.");
        }
    }

    // ==========================================
    // 8. TABLE & EDIT FUNCTIONALITY
    // ==========================================
    function renderTable() {
        const db = JSON.parse(localStorage.getItem('herbarium_db')) || [];
        localDbBody.innerHTML = '';
        
        // Sort by newest first
        db.reverse().forEach(specimen => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td><img src="${specimen.image}" style="height:50px;width:50px;object-fit:cover;border-radius:4px;"></td>
                <td class="fw-bold">${specimen.id}</td>
                <td>
                    ${specimen.scientificName}<br>
                    <small class="text-muted">${specimen.collector} • ${specimen.location}</small>
                </td>
                <td>
                    <button class="btn btn-sm btn-outline-primary" onclick="editSpecimen('${specimen.id}')">✏️ Edit</button>
                </td>
            `;
            localDbBody.appendChild(row);
        });
    }

    // Expose edit function to global scope so HTML can call it
    window.editSpecimen = function(id) {
        const db = JSON.parse(localStorage.getItem('herbarium_db')) || [];
        const item = db.find(i => i.id === id);
        
        if (!item) return;

        // Enter Edit Mode
        isEditMode = true;
        editId = id;
        originalImageBase64 = item.image; // Store old image

        // Populate Form
        inputs.accession.value = item.id;
        inputs.date.value = item.date;
        inputs.collector.value = item.collector;
        inputs.location.value = item.location;
        inputs.binomial.value = item.scientificName;
        inputs.family.value = item.family;
        inputs.genus.value = item.genus;
        inputs.author.value = item.author;

        // UI Changes
        saveLocalBtn.textContent = "🔄 Update Specimen";
        saveLocalBtn.classList.replace('btn-primary', 'btn-warning');
        cancelEditBtn.classList.remove('d-none');
        
        // Show Image Preview (User can click Capture/Upload to replace it)
        previewContainer.style.display = 'block';
        capturedImage.src = item.image;
        scannerContainer.style.display = 'none';
        video.style.display = 'none';
        
        // Scroll to top
        window.scrollTo(0, 0);
    };

    cancelEditBtn.addEventListener('click', resetApp);

    function resetApp() {
        // Clear Inputs
        inputs.accession.value = ''; inputs.binomial.value = ''; 
        inputs.family.value = ''; inputs.genus.value = ''; inputs.author.value = '';
        inputs.date.value = ''; inputs.collector.value = ''; inputs.location.value = '';
        inputs.hint.textContent = 'Start typing to search GBIF...';

        // Reset State
        isEditMode = false;
        editId = null;
        originalImageBase64 = null;
        currentProcessedBlob = null;
        if(cropper) cropper.destroy();

        // UI Reset
        previewContainer.style.display = 'none';
        scannerContainer.style.display = 'block';
        video.style.display = 'block';
        saveLocalBtn.textContent = "💾 Save Specimen";
        saveLocalBtn.classList.replace('btn-warning', 'btn-primary');
        cancelEditBtn.classList.add('d-none');
        
        captureBtn.textContent = "📸 Capture";
        captureBtn.classList.remove('btn-secondary', 'btn-warning');
        captureBtn.classList.add('btn-success');
        captureBtn.disabled = false;

        if(!stream) startCamera();
    }

    // Initial Render
    renderTable();
});
