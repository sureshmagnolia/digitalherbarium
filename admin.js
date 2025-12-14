document.addEventListener('DOMContentLoaded', () => {

    // ==========================================
    // 1. INITIALIZATION & VARIABLES
    // ==========================================
    
    // Camera & Preview Elements
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
    
    // Status & Data Display
    const cvStatus = document.getElementById('cv-status');
    const localDbBody = document.getElementById('local-db-body');
    
    // Form Inputs
    const inputs = {
        accession: document.getElementById('accession-number'),
        binomial: document.getElementById('binomial-input'),
        family: document.getElementById('family'),
        genus: document.getElementById('genus'),
        author: document.getElementById('author'),
        suggestions: document.getElementById('taxonomy-suggestions'),
        hint: document.getElementById('taxa-hint')
    };

    // State Variables
    let html5QrCode; 
    let cropper; 
    let stream;
    let debounceTimer;
    let currentProcessedBlob = null; 

    // ==========================================
    // 2. CAMERA MANAGEMENT
    // ==========================================

    async function startCamera() {
        try {
            // Request Back Camera with HD Resolution
            stream = await navigator.mediaDevices.getUserMedia({ 
                video: { 
                    facingMode: "environment", 
                    width: { ideal: 1920 }, 
                    height: { ideal: 1080 } 
                } 
            });
            video.srcObject = stream;
            video.style.display = 'block';
        } catch (err) {
            console.error("Camera Error:", err);
            // On desktop without webcam, this might fail, but upload will still work
        }
    }
    
    // Initialize Camera on Load
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
        // Pause Camera Stream to release control
        if(stream) {
            video.srcObject.getTracks().forEach(track => track.stop());
            video.style.display = 'none';
        }

        // Show Overlay
        document.getElementById('scan-region-highlight').style.display = 'block';

        // Start Scanner
        html5QrCode = new Html5Qrcode("scanner-container");
        const config = { fps: 10, qrbox: { width: 250, height: 150 } };
        
        html5QrCode.start({ facingMode: "environment" }, config, (decodedText) => {
            // Success
            inputs.accession.value = decodedText;
            
            // Cleanup & Restart Camera
            html5QrCode.stop().then(() => {
                document.getElementById('scan-region-highlight').style.display = 'none';
                video.style.display = 'block';
                startCamera(); 
            });
        }, 
        (errorMessage) => {
            // Scanning in progress...
        }).catch(err => console.log(err));
    });

    // ==========================================
    // 4. IMAGE CAPTURE & UPLOAD LOGIC
    // ==========================================

    // A. Capture Button Click
    captureBtn.addEventListener('click', async () => {
        // Check text to decide: Are we Capturing or Confirming Crop?
        if (captureBtn.textContent.includes("Capture")) {
            
            // 1. Check AI Engine Status
            if(!window.cvReady) { 
                alert("AI Engine (OpenCV) is still loading... please wait."); 
                return; 
            }

            // 2. UI Feedback
            captureBtn.textContent = "Processing...";
            captureBtn.disabled = true;

            // 3. Grab Frame from Video
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0);

            // 4. Send to OpenCV
            await processImageWithOpenCV(canvas);

        } else if (captureBtn.textContent.includes("Confirm")) {
            // SAVE PHASE: Finalize the crop
            finishCrop();
        }
    });

    // B. Upload from Gallery Logic
    uploadTrigger.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            const reader = new FileReader();
            reader.onload = function(e) {
                // Create Image object to get dimensions
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    
                    // Stop Camera Logic
                    if(stream) {
                        video.srcObject.getTracks().forEach(track => track.stop());
                        video.style.display = 'none';
                    }
                    
                    // Process
                    if(!window.cvReady) {
                        alert("Please wait a moment for AI Engine to load.");
                        return;
                    }
                    processImageWithOpenCV(canvas);
                };
                img.src = e.target.result;
            }
            reader.readAsDataURL(e.target.files[0]);
        }
    });

    // ==========================================
    // 5. OPENCV AUTO-STRAIGHTENING (THE AI)
    // ==========================================

    async function processImageWithOpenCV(sourceCanvas) {
        try {
            console.log("Starting OpenCV processing...");
            
            // --- CV SETUP ---
            let src = cv.imread(sourceCanvas);
            let dst = new cv.Mat();
            let ksize = new cv.Size(5, 5);
            
            // 1. Resize for detection (Working on 1920px is too slow, resize to 500px width)
            let dsize = new cv.Size(0, 0);
            let scale = 500 / src.cols; 
            cv.resize(src, dst, dsize, scale, scale, cv.INTER_AREA);

            // 2. Pre-processing (Grayscale -> Blur -> Canny Edges)
            cv.cvtColor(dst, dst, cv.COLOR_RGBA2GRAY, 0);
            cv.GaussianBlur(dst, dst, ksize, 0, 0, cv.BORDER_DEFAULT);
            cv.Canny(dst, dst, 75, 200);

            // 3. Find Contours
            let contours = new cv.MatVector();
            let hierarchy = new cv.Mat();
            cv.findContours(dst, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

            // 4. Find the Sheet (Largest 4-sided Polygon)
            let maxArea = 0;
            let maxCnt = null;
            let approx = new cv.Mat();

            for (let i = 0; i < contours.size(); ++i) {
                let cnt = contours.get(i);
                let area = cv.contourArea(cnt);
                
                // Filter small noise
                if (area > 5000) { 
                    let peri = cv.arcLength(cnt, true);
                    cv.approxPolyDP(cnt, approx, 0.02 * peri, true);
                    
                    // Check if it has 4 corners and is the biggest we've seen
                    if (approx.rows === 4 && area > maxArea) {
                        maxArea = area;
                        maxCnt = approx.clone(); 
                    }
                }
            }

            // 5. Warp Perspective (Straighten)
            if (maxCnt) {
                console.log("Document edges found!");

                // Scale points back up to original resolution
                let inputPts = [];
                for(let i=0; i<4; i++) {
                    inputPts.push(maxCnt.data32S[i*2] / scale);     // x
                    inputPts.push(maxCnt.data32S[i*2 + 1] / scale); // y
                }

                // Sort corners: TL, TR, BR, BL
                const orderedPts = orderPoints(inputPts);

                // Calculate width/height of the new flattened image
                let widthA = Math.hypot(orderedPts[2] - orderedPts[0], orderedPts[3] - orderedPts[1]);
                let widthB = Math.hypot(orderedPts[6] - orderedPts[4], orderedPts[7] - orderedPts[5]);
                let maxWidth = Math.max(widthA, widthB);

                let heightA = Math.hypot(orderedPts[4] - orderedPts[0], orderedPts[5] - orderedPts[1]);
                let heightB = Math.hypot(orderedPts[6] - orderedPts[2], orderedPts[7] - orderedPts[3]);
                let maxHeight = Math.max(heightA, heightB);

                // Transform Matrices
                let srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, orderedPts);
                let dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, maxWidth, 0, maxWidth, maxHeight, 0, maxHeight]);
                
                // Execute Warp
                let M = cv.getPerspectiveTransform(srcTri, dstTri);
                let warped = new cv.Mat();
                cv.warpPerspective(src, warped, M, new cv.Size(maxWidth, maxHeight), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

                // Display Result
                cv.imshow('captured-image', warped);
                
                // Clean up matrices
                srcTri.delete(); dstTri.delete(); M.delete(); warped.delete();
                cvStatus.textContent = "Auto-Straightened";
            } else {
                // Fallback: No clear document found
                console.log("No document found, using original.");
                cv.imshow('captured-image', src);
                cvStatus.textContent = "Manual Mode";
            }

            // Clean Memory
            src.delete(); dst.delete(); contours.delete(); hierarchy.delete(); 
            if(approx) approx.delete(); 
            if(maxCnt) maxCnt.delete();

            // 6. Switch to Editor View
            video.style.display = 'none';
            scannerContainer.style.display = 'none';
            previewContainer.style.display = 'block';

            // 7. Initialize Manual Cropper (for fine-tuning)
            initCropper();

        } catch (e) {
            console.error("OpenCV Error:", e);
            alert("Error in AI processing. Reverting to basic capture.");
            // Panic Fallback
            capturedImage.src = sourceCanvas.toDataURL();
            initCropper();
        }
    }

    // Helper: Sort 4 points into TL, TR, BR, BL order
    function orderPoints(pts) {
        let points = [
            {x: pts[0], y: pts[1]}, {x: pts[2], y: pts[3]},
            {x: pts[4], y: pts[5]}, {x: pts[6], y: pts[7]}
        ];
        // Sort by Y (Top 2 vs Bottom 2)
        points.sort((a,b) => a.y - b.y);
        let top = points.slice(0, 2).sort((a,b) => a.x - b.x); 
        let bottom = points.slice(2, 4).sort((a,b) => a.x - b.x);
        return [
            top[0].x, top[0].y,      // TL
            top[1].x, top[1].y,      // TR
            bottom[1].x, bottom[1].y,// BR (Note: usually max X max Y)
            bottom[0].x, bottom[0].y // BL
        ];
    }

    // ==========================================
    // 6. MANUAL CROPPER & FINALIZATION
    // ==========================================

    function initCropper() {
        if(cropper) cropper.destroy();
        cropper = new Cropper(capturedImage, {
            viewMode: 1, 
            autoCropArea: 0.9, 
            movable: false, 
            rotatable: true, 
            zoomable: false,
        });

        // Update Button State
        captureBtn.textContent = "✅ Confirm Crop";
        captureBtn.classList.replace('btn-success', 'btn-warning');
        captureBtn.disabled = false;
    }

    function finishCrop() {
        if(!cropper) return;
        
        // Compress and Crop
        cropper.getCroppedCanvas({ width: 1600 }).toBlob((blob) => {
            currentProcessedBlob = blob;
            
            // UI Feedback
            captureBtn.textContent = `Ready (${(blob.size/1024).toFixed(0)} KB)`;
            captureBtn.classList.replace('btn-warning', 'btn-secondary');
            captureBtn.disabled = true; // Prevent re-clicking
            
        }, 'image/jpeg', 0.7); // 70% Quality JPEG
    }

    // ==========================================
    // 7. SMART TAXONOMY (2-STEP: SUGGEST -> MATCH)
    // ==========================================

    // Step A: Suggestions while typing
    inputs.binomial.addEventListener('input', (e) => {
        const query = e.target.value;
        if (query.length < 3) return;
        
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => fetchSuggestions(query), 300);
    });

    // Step B: Fetch EXACT Details when user selects
    inputs.binomial.addEventListener('change', (e) => {
        const selectedName = e.target.value;
        if(selectedName.length > 3) {
            fetchExactDetails(selectedName);
        }
    });

    async function fetchSuggestions(query) {
        // GBIF Backbone Taxonomy Dataset Key
        const url = `https://api.gbif.org/v1/species/suggest?q=${query}&rank=SPECIES&datasetKey=d7dddbf4-2cf0-4f39-9b2a-bb099caae36c`;
        
        try {
            const response = await fetch(url);
            const data = await response.json();
            
            inputs.suggestions.innerHTML = ''; 
            data.forEach(item => {
                const option = document.createElement('option');
                option.value = item.scientificName; 
                inputs.suggestions.appendChild(option);
            });
        } catch (error) { console.error("GBIF Suggest Error:", error); }
    }

    async function fetchExactDetails(name) {
        // Use MATCH API for Authoritative Data
        const url = `https://api.gbif.org/v1/species/match?name=${encodeURIComponent(name)}&kingdom=Plantae`;

        try {
            inputs.hint.textContent = "Fetching details...";
            
            const response = await fetch(url);
            const data = await response.json();

            if (data.matchType !== 'NONE') {
                inputs.family.value = data.family || "Unknown";
                inputs.genus.value = data.genus || "Unknown";

                // Fix Author Citation Logic
                if (data.authorship) {
                    inputs.author.value = data.authorship;
                } else if (data.scientificName.includes(data.canonicalName)) {
                    inputs.author.value = data.scientificName.replace(data.canonicalName, '').trim();
                } else {
                    inputs.author.value = "";
                }

                inputs.hint.innerHTML = `✅ Accepted: <b>${data.canonicalName}</b>`;
                inputs.hint.className = 'small text-success';

            } else {
                inputs.hint.textContent = "⚠️ Name not found in GBIF Backbone";
                inputs.hint.className = 'small text-danger';
            }
        } catch (error) {
            console.error("GBIF Match Error:", error);
            inputs.hint.textContent = "Connection Error";
        }
    }

    // ==========================================
    // 8. SAVE TO LOCAL DATABASE
    // ==========================================

    saveLocalBtn.addEventListener('click', () => {
        // Validation
        if (!currentProcessedBlob) { 
            alert("Please capture/upload an image first!"); 
            return; 
        }
        if (!inputs.accession.value || !inputs.binomial.value) { 
            alert("Please fill Accession # and Scientific Name."); 
            return; 
        }

        // Create Data Object
        const specimen = {
            id: inputs.accession.value,
            name: inputs.binomial.value,
            family: inputs.family.value,
            size: (currentProcessedBlob.size / 1024).toFixed(1) + " KB",
            imgUrl: URL.createObjectURL(currentProcessedBlob) // Blob URL for preview
        };

        // Add Row to Table
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><img src="${specimen.imgUrl}" style="height:50px;width:50px;object-fit:cover;border-radius:4px;"></td>
            <td class="fw-bold">${specimen.id}</td>
            <td>${specimen.name}<br><small class="text-muted">${specimen.family}</small></td>
            <td>${specimen.size}</td>
        `;
        localDbBody.prepend(row);

        // Reset App for Next Scan
        resetApp();
    });

    function resetApp() {
        // Clear Inputs
        inputs.accession.value = ''; inputs.binomial.value = ''; 
        inputs.family.value = ''; inputs.genus.value = ''; inputs.author.value = '';
        inputs.hint.textContent = 'Start typing to search GBIF...';
        inputs.hint.className = 'small text-muted';

        // Clear State
        currentProcessedBlob = null;
        if(cropper) cropper.destroy();
        
        // Reset View
        previewContainer.style.display = 'none';
        scannerContainer.style.display = 'block';
        video.style.display = 'block';
        
        // Reset Buttons
        captureBtn.textContent = "📸 Capture";
        captureBtn.classList.remove('btn-secondary', 'btn-warning');
        captureBtn.classList.add('btn-success');
        captureBtn.disabled = false;
        
        // Restart Camera if needed
        if(!stream) startCamera();
    }
});
