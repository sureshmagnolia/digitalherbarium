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
    
    // Inputs (UPDATED with Collection Number & Type Status)
    const inputs = {
        accession: document.getElementById('accession-number'),
        collectionNumber: document.getElementById('collection-number'), // NEW
        typeStatus: document.getElementById('type-status'),           // NEW
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
    let editId = null;
    let originalImageBase64 = null;

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
            toggleCameraBtn.textContent = "Start Cam";
        } else {
            startCamera();
            toggleCameraBtn.textContent = "Stop Cam";
        }
    });

    // ==========================================
    // 3. MANUAL BARCODE SCANNER (FALLBACK)
    // ==========================================
    scanBarcodeBtn.addEventListener('click', () => {
        if(stream) { video.srcObject.getTracks().forEach(track => track.stop()); video.style.display = 'none'; }
        
        // Use scannerContainer for the full dedicated view
        html5QrCode = new Html5Qrcode("scanner-container");
        
        // Configuration for faster dedicated scan
        html5QrCode.start({ facingMode: "environment" }, { fps: 15, qrbox: { width: 300, height: 100 } }, 
        (decodedText) => {
            inputs.accession.value = decodedText;
            html5QrCode.stop().then(() => {
                // Return to normal view
                video.style.display = 'block';
                startCamera(); 
            });
        }, (errorMessage) => {}).catch(err => console.log(err));
    });

    // ==========================================
    // 4. IMAGE CAPTURE (SMART) & UPLOAD
    // ==========================================
    captureBtn.addEventListener('click', async () => {
        if (captureBtn.textContent.includes("Capture")) {
            if(!window.cvReady) { alert("AI Engine loading..."); return; }
            
            // 1. Barcode Check (Quick check on current frame)
            const barcodeResult = await readBarcodeFromFrame(video);
            if (barcodeResult && !inputs.accession.value) {
                inputs.accession.value = barcodeResult;
                console.log(`Barcode Auto-filled: ${barcodeResult}`);
            }

            // 2. Proceed to Image Processing
            captureBtn.textContent = "Processing..."; captureBtn.disabled = true;

            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth; canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d'); ctx.drawImage(video, 0, 0);
            await processImageWithOpenCV(canvas);

        } else if (captureBtn.textContent.includes("Confirm")) {
            finishCrop();
        }
    });

    // Helper to read barcode from a single video frame (for capture button)
    function readBarcodeFromFrame(videoElement) {
        return new Promise(resolve => {
            // Use a temporary library instance for single frame scan
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = videoElement.videoWidth;
            tempCanvas.height = videoElement.videoHeight;
            const ctx = tempCanvas.getContext('2d');
            ctx.drawImage(videoElement, 0, 0, tempCanvas.width, tempCanvas.height);

            // Using the temporary library object provided by html5-qrcode
            Html5Qrcode.getCandidates().forEach(candidate => {
                candidate.scan().then(decodedText => {
                    resolve(decodedText);
                }).catch(() => {
                    // Ignore error, continue trying to scan
                });
            });

            // If no immediate result after 500ms, assume no barcode found
            setTimeout(() => resolve(null), 500); 
        });
    }

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
    // 5. OPENCV AUTO-STRAIGHTENING (UNCHANGED)
    // ==========================================
    async function processImageWithOpenCV(sourceCanvas) {
        // ... (OpenCV code from previous response - too long to duplicate fully)
        // [NOTE: This section remains the same as the final version of the previous admin.js]
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
    // 6. SMART TAXONOMY (UNCHANGED)
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
        // Validation: Required Fields (UPDATED)
        if (!inputs.accession.value || !inputs.binomial.value || !inputs.date.value || !inputs.collector.value || !inputs.location.value || !inputs.collectionNumber.value) { 
            alert("Please fill ALL mandatory fields (*)."); 
            return; 
        }

        if (currentProcessedBlob) {
            const reader = new FileReader();
            reader.readAsDataURL(currentProcessedBlob);
            reader.onloadend = function() {
                saveToStorage(reader.result);
            }
        } else if (isEditMode && originalImageBase64) {
            saveToStorage(originalImageBase64);
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
            date: inputs.date.value,
            collector: inputs.collector.value,
            location: inputs.location.value,
            collectionNumber: inputs.collectionNumber.value, // NEW
            typeStatus: inputs.typeStatus.value,             // NEW
            image: base64Image,
            size: currentProcessedBlob ? (currentProcessedBlob.size / 1024).toFixed(1) + " KB" : "Unchanged"
        };

        try {
            let db = JSON.parse(localStorage.getItem('herbarium_db')) || [];

            if (isEditMode) {
                db = db.filter(item => item.id !== editId);
                alert("Specimen Updated Successfully!");
            } else {
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
    // 8. TABLE & EDIT FUNCTIONALITY (UPDATED)
    // ==========================================
    function renderTable() {
        const db = JSON.parse(localStorage.getItem('herbarium_db')) || [];
        localDbBody.innerHTML = '';
        
        db.reverse().forEach(specimen => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td><img src="${specimen.image}" style="height:50px;width:50px;object-fit:cover;border-radius:4px;"></td>
                <td class="fw-bold">${specimen.id}</td>
                <td>
                    ${specimen.scientificName}<br>
                    <small class="text-muted">${specimen.collector} (${specimen.collectionNumber})</small>
                </td>
                <td>
                    <button class="btn btn-sm btn-outline-primary" onclick="editSpecimen('${specimen.id}')">✏️ Edit</button>
                </td>
            `;
            localDbBody.appendChild(row);
        });
    }

    window.editSpecimen = function(id) {
        const db = JSON.parse(localStorage.getItem('herbarium_db')) || [];
        const item = db.find(i => i.id === id);
        
        if (!item) return;

        isEditMode = true;
        editId = id;
        originalImageBase64 = item.image;

        // Populate Form (UPDATED)
        inputs.accession.value = item.id;
        inputs.collectionNumber.value = item.collectionNumber; // NEW
        inputs.typeStatus.value = item.typeStatus || 'None';    // NEW
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
        
        // Show Image Preview
        previewContainer.style.display = 'block';
        capturedImage.src = item.image;
        scannerContainer.style.display = 'none';
        video.style.display = 'none';
        
        window.scrollTo(0, 0);
    };

    cancelEditBtn.addEventListener('click', resetApp);

    function resetApp() {
        // Clear Inputs
        inputs.accession.value = ''; inputs.binomial.value = ''; 
        inputs.family.value = ''; inputs.genus.value = ''; inputs.author.value = '';
        inputs.date.value = ''; inputs.collector.value = ''; inputs.location.value = '';
        inputs.collectionNumber.value = ''; inputs.typeStatus.value = 'None'; // NEW FIELDS RESET
        inputs.hint.textContent = 'Start typing to search GBIF...';

        // Reset State
        isEditMode = false; editId = null; originalImageBase64 = null; currentProcessedBlob = null;
        if(cropper) cropper.destroy();

        // UI Reset
        previewContainer.style.display = 'none';
        scannerContainer.style.display = 'block';
        video.style.display = 'block';
        saveLocalBtn.textContent = "💾 Save Specimen";
        saveLocalBtn.classList.replace('btn-warning', 'btn-primary');
        cancelEditBtn.classList.add('d-none');
        
        captureBtn.textContent = "📸 Capture Sheet (Auto-Read Barcode)";
        captureBtn.classList.remove('btn-secondary', 'btn-warning');
        captureBtn.classList.add('btn-success');
        captureBtn.disabled = false;

        if(!stream) startCamera();
    }

    // Initial Render
    renderTable();
});
