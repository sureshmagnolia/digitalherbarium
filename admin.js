document.addEventListener('DOMContentLoaded', () => {

    // --- VARIABLES ---
    const video = document.getElementById('video-feed');
    const captureBtn = document.getElementById('btn-capture');
    const scanBarcodeBtn = document.getElementById('btn-scan-barcode');
    const toggleCameraBtn = document.getElementById('btn-toggle-camera');
    const saveLocalBtn = document.getElementById('btn-save-local');
    const fileInput = document.getElementById('file-input');
    const uploadTrigger = document.getElementById('btn-upload-trigger');
    
    // UI Containers
    const scannerContainer = document.getElementById('scanner-container');
    const previewContainer = document.getElementById('image-preview-container');
    const capturedImage = document.getElementById('captured-image');
    const localDbBody = document.getElementById('local-db-body');
    const cvStatus = document.getElementById('cv-status');
    
    // Inputs
    const inputs = {
        accession: document.getElementById('accession-number'),
        binomial: document.getElementById('binomial-input'),
        family: document.getElementById('family'),
        genus: document.getElementById('genus'),
        author: document.getElementById('author'),
        suggestions: document.getElementById('taxonomy-suggestions'),
        hint: document.getElementById('taxa-hint')
    };

    let html5QrCode; 
    let cropper; 
    let stream;
    let debounceTimer;
    let currentProcessedBlob = null; 

    // --- 1. CAMERA ---
    async function startCamera() {
        try {
            stream = await navigator.mediaDevices.getUserMedia({ 
                video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } } 
            });
            video.srcObject = stream;
            video.style.display = 'block';
        } catch (err) {
            console.error("Camera Error:", err);
            // alert("Please allow camera access.");
        }
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

    // --- 2. BARCODE ---
    scanBarcodeBtn.addEventListener('click', () => {
        if(stream) {
            video.srcObject.getTracks().forEach(track => track.stop());
            video.style.display = 'none';
        }
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
        }, 
        (errorMessage) => {}).catch(err => console.log(err));
    });

    // --- 3. CAPTURE / UPLOAD ROUTER ---
    
    // A. From Camera
    captureBtn.addEventListener('click', async () => {
        if (captureBtn.textContent.includes("Capture")) {
            // Check if OpenCV is ready
            if(!window.cvReady) { alert("AI Engine loading..."); return; }

            // Loading state
            captureBtn.textContent = "Processing...";
            captureBtn.disabled = true;

            // Grab Frame
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0);

            // PROCESS IT (Auto-Straighten)
            await processImageWithOpenCV(canvas);

        } else {
            // SAVE PHASE
            finishCrop();
        }
    });

    // B. From Gallery
    uploadTrigger.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            const reader = new FileReader();
            reader.onload = function(e) {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    
                    if(stream) {
                        video.srcObject.getTracks().forEach(track => track.stop());
                        video.style.display = 'none';
                    }
                    
                    // Allow OpenCV to load if user was fast
                    if(!window.cvReady) {
                        alert("Please wait 2 seconds for AI Engine to load, then try again.");
                        return;
                    }
                    processImageWithOpenCV(canvas);
                };
                img.src = e.target.result;
            }
            reader.readAsDataURL(e.target.files[0]);
        }
    });


    // --- 4. OPENCV AUTO-STRAIGHTEN LOGIC ---
    function processImageWithOpenCV(sourceCanvas) {
        try {
            console.log("Starting OpenCV processing...");
            let src = cv.imread(sourceCanvas);
            let dst = new cv.Mat();
            let ksize = new cv.Size(5, 5);
            
            // 1. Downscale for detection (speed)
            let dsize = new cv.Size(0, 0);
            let scale = 500 / src.cols; // Resize to width 500
            cv.resize(src, dst, dsize, scale, scale, cv.INTER_AREA);

            // 2. Preprocess
            cv.cvtColor(dst, dst, cv.COLOR_RGBA2GRAY, 0);
            cv.GaussianBlur(dst, dst, ksize, 0, 0, cv.BORDER_DEFAULT);
            cv.Canny(dst, dst, 75, 200);

            // 3. Find Contours
            let contours = new cv.MatVector();
            let hierarchy = new cv.Mat();
            cv.findContours(dst, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

            // 4. Find largest Quadrilateral
            let maxArea = 0;
            let maxCnt = null;
            let approx = new cv.Mat();

            for (let i = 0; i < contours.size(); ++i) {
                let cnt = contours.get(i);
                let area = cv.contourArea(cnt);
                if (area > 5000) { // Minimum area filter
                    let peri = cv.arcLength(cnt, true);
                    cv.approxPolyDP(cnt, approx, 0.02 * peri, true);
                    if (approx.rows === 4 && area > maxArea) {
                        maxArea = area;
                        maxCnt = approx.clone(); // Store the corner points
                    }
                }
            }

            // 5. WARP PERSECTIVE (If quad found)
            if (maxCnt) {
                console.log("Document detected! Straightening...");
                
                // Scale points back up to original resolution
                let inputPts = [];
                for(let i=0; i<4; i++) {
                    inputPts.push(maxCnt.data32S[i*2] / scale);     // x
                    inputPts.push(maxCnt.data32S[i*2 + 1] / scale); // y
                }

                // Order corners (TL, TR, BR, BL)
                const orderedPts = orderPoints(inputPts);

                // Calculate width/height of new flattened image
                let widthA = Math.hypot(orderedPts[2] - orderedPts[0], orderedPts[3] - orderedPts[1]);
                let widthB = Math.hypot(orderedPts[6] - orderedPts[4], orderedPts[7] - orderedPts[5]);
                let maxWidth = Math.max(widthA, widthB);

                let heightA = Math.hypot(orderedPts[4] - orderedPts[0], orderedPts[5] - orderedPts[1]);
                let heightB = Math.hypot(orderedPts[6] - orderedPts[2], orderedPts[7] - orderedPts[3]);
                let maxHeight = Math.max(heightA, heightB);

                // Source and Destination matrices
                let srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, orderedPts);
                let dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, maxWidth, 0, maxWidth, maxHeight, 0, maxHeight]);
                
                // Apply Warp
                let M = cv.getPerspectiveTransform(srcTri, dstTri);
                let warped = new cv.Mat();
                cv.warpPerspective(src, warped, M, new cv.Size(maxWidth, maxHeight), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

                // Show Result
                cv.imshow('captured-image', warped);
                
                // Cleanup
                srcTri.delete(); dstTri.delete(); M.delete(); warped.delete();
                cvStatus.textContent = "Auto-Straightened";
            } else {
                console.log("No clear document found. Using original.");
                // Fallback: Just show original
                cv.imshow('captured-image', src);
                cvStatus.textContent = "Manual Crop Mode";
            }

            // Clean Memory
            src.delete(); dst.delete(); contours.delete(); hierarchy.delete(); if(approx) approx.delete(); if(maxCnt) maxCnt.delete();

            // SWITCH VIEW
            video.style.display = 'none';
            scannerContainer.style.display = 'none';
            previewContainer.style.display = 'block';

            // START CROPPER (For final adjustment)
            initCropper();

        } catch (e) {
            console.error("OpenCV Error:", e);
            alert("Error in AI processing. Reverting to manual.");
            // Fallback
            capturedImage.src = sourceCanvas.toDataURL();
            video.style.display = 'none';
            scannerContainer.style.display = 'none';
            previewContainer.style.display = 'block';
            initCropper();
        }
    }

    // Helper: Order coordinates TL, TR, BR, BL
    function orderPoints(pts) {
        // pts = [x1, y1, x2, y2, x3, y3, x4, y4]
        // Convert to array of objects
        let points = [
            {x: pts[0], y: pts[1]}, {x: pts[2], y: pts[3]},
            {x: pts[4], y: pts[5]}, {x: pts[6], y: pts[7]}
        ];

        // Sort by y to get top two and bottom two
        points.sort((a,b) => a.y - b.y);
        let top = points.slice(0, 2).sort((a,b) => a.x - b.x); // TL, TR
        let bottom = points.slice(2, 4).sort((a,b) => b.x - a.x); // BR, BL (Note: BR is usually max X, max Y) but logic varies. 
        // Standard: TL, TR, BR, BL. 
        // Let's refine:
        // Sum (x+y): TL is smallest, BR is largest
        // Diff (y-x): TR is smallest, BL is largest
        
        let sums = points.map(p => p.x + p.y);
        let diffs = points.map(p => p.y - p.x);
        
        // This simple sort is sometimes buggy for extreme angles, but sufficient for herbarium sheets
        // Let's stick to the visual sort above which is generally safer for document scan
        return [
            top[0].x, top[0].y,   // TL
            top[1].x, top[1].y,   // TR
            bottom[0].x, bottom[0].y, // BR (Actually bottom[0] is Rightmost of bottom row)
            bottom[1].x, bottom[1].y  // BL
        ];
    }

    function initCropper() {
        if(cropper) cropper.destroy();
        cropper = new Cropper(capturedImage, {
            viewMode: 1, 
            autoCropArea: 0.9, // Almost full screen since we likely already cropped it
            movable: false, 
            rotatable: true, 
            zoomable: false,
        });

        // Update UI
        captureBtn.textContent = "✅ Confirm Crop";
        captureBtn.classList.replace('btn-success', 'btn-warning');
        captureBtn.disabled = false;
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

    // --- 5. DATA & SAVE ---
    inputs.binomial.addEventListener('input', (e) => {
        const query = e.target.value;
        if (query.length < 3) return;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => fetchSpeciesSuggestions(query), 300);
    });

    async function fetchSpeciesSuggestions(query) {
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
            const exactMatch = data.find(d => d.scientificName === query);
            if (exactMatch) {
                inputs.family.value = exactMatch.family || "Unknown";
                inputs.genus.value = exactMatch.genus || "Unknown";
                inputs.author.value = exactMatch.authorship || "";
                inputs.hint.textContent = `✅ Verified: ${exactMatch.scientificName}`;
                inputs.hint.classList.replace('text-muted', 'text-success');
            }
        } catch (error) { console.error("GBIF Error:", error); }
    }

    saveLocalBtn.addEventListener('click', () => {
        if (!currentProcessedBlob) { alert("Please capture an image!"); return; }
        if (!inputs.accession.value || !inputs.binomial.value) { alert("Please fill details."); return; }

        const specimen = {
            id: inputs.accession.value,
            name: inputs.binomial.value,
            family: inputs.family.value,
            size: (currentProcessedBlob.size / 1024).toFixed(1) + " KB",
            imgUrl: URL.createObjectURL(currentProcessedBlob)
        };

        const row = document.createElement('tr');
        row.innerHTML = `<td><img src="${specimen.imgUrl}" style="height:50px;width:50px;object-fit:cover;"></td><td class="fw-bold">${specimen.id}</td><td>${specimen.name}<br><small class="text-muted">${specimen.family}</small></td><td>${specimen.size}</td>`;
        localDbBody.prepend(row);

        // Reset
        inputs.accession.value = ''; inputs.binomial.value = ''; inputs.family.value = ''; inputs.genus.value = ''; inputs.author.value = '';
        currentProcessedBlob = null;
        if(cropper) cropper.destroy();
        previewContainer.style.display = 'none';
        scannerContainer.style.display = 'block';
        video.style.display = 'block';
        if(!stream) startCamera();
        
        captureBtn.textContent = "📸 Capture";
        captureBtn.classList.remove('btn-secondary', 'btn-warning');
        captureBtn.classList.add('btn-success');
        captureBtn.disabled = false;
    });
});
