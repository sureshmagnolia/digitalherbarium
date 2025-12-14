document.addEventListener('DOMContentLoaded', () => {

    // --- VARIABLES ---
    const video = document.getElementById('video-feed');
    const captureBtn = document.getElementById('btn-capture');
    const scanBarcodeBtn = document.getElementById('btn-scan-barcode');
    const toggleCameraBtn = document.getElementById('btn-toggle-camera');
    const accessionInput = document.getElementById('accession-number');
    const scannerContainer = document.getElementById('scanner-container');
    const previewContainer = document.getElementById('image-preview-container');
    const capturedImage = document.getElementById('captured-image');
    
    // Taxonomy Inputs
    const binomialInput = document.getElementById('binomial-input');
    const suggestionsList = document.getElementById('taxonomy-suggestions');
    const familyInput = document.getElementById('family');
    const genusInput = document.getElementById('genus');
    const authorInput = document.getElementById('author');

    let html5QrCode; 
    let cropper; 
    let stream;
    let debounceTimer;

    // --- 1. CAMERA FUNCTIONS ---
    async function startCamera() {
        try {
            stream = await navigator.mediaDevices.getUserMedia({ 
                video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } } 
            });
            video.srcObject = stream;
            video.style.display = 'block';
        } catch (err) {
            console.error("Camera Error:", err);
            alert("Please allow camera access.");
        }
    }
    
    // Start camera immediately
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

    // --- 2. BARCODE SCANNING ---
    scanBarcodeBtn.addEventListener('click', () => {
        // Stop raw video stream first
        if(stream) {
            video.srcObject.getTracks().forEach(track => track.stop());
            video.style.display = 'none';
        }

        document.getElementById('scan-region-highlight').style.display = 'block';

        html5QrCode = new Html5Qrcode("scanner-container");
        const config = { fps: 10, qrbox: { width: 250, height: 150 } };
        
        html5QrCode.start({ facingMode: "environment" }, config, (decodedText) => {
            // Success
            console.log(`Barcode: ${decodedText}`);
            accessionInput.value = decodedText;
            
            // Stop Scanner & Restart Camera
            html5QrCode.stop().then(() => {
                document.getElementById('scan-region-highlight').style.display = 'none';
                video.style.display = 'block';
                startCamera(); 
            });
        }, (errorMessage) => {
            // Scanning...
        }).catch(err => console.log(err));
    });

    // --- 3. CAPTURE & CROP ---
    captureBtn.addEventListener('click', () => {
        // Check if we are currently in "Capture" mode or "Save" mode
        if (captureBtn.textContent.includes("Capture")) {
            // 1. Capture the frame
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            // 2. Show Preview
            capturedImage.src = canvas.toDataURL('image/jpeg');
            video.style.display = 'none';
            scannerContainer.style.display = 'none';
            previewContainer.style.display = 'block';

            // 3. Init Cropper
            if(cropper) cropper.destroy();
            cropper = new Cropper(capturedImage, {
                viewMode: 1,
                autoCropArea: 0.8,
                movable: false,
                rotatable: true,
                zoomable: false,
            });

            // 4. Update Button
            captureBtn.textContent = "💾 Save & Compress";
            captureBtn.classList.replace('btn-success', 'btn-primary');
            
            // Change button behavior to "Save"
            captureBtn.onclick = saveCompressedImage;

        } else {
            // Already in Save mode, function is handled by onclick reassignment below
            saveCompressedImage();
        }
    });

    function saveCompressedImage() {
        if(!cropper) return;

        cropper.getCroppedCanvas({ width: 1600 }).toBlob((blob) => {
            console.log("Compressed Size: " + (blob.size / 1024).toFixed(2) + " KB");
            alert(`Image Processed!\nSize: ${(blob.size / 1024).toFixed(2)} KB\nReady for Firebase upload.`);
            
            // RESET UI for next scan
            // In a real app, here you would trigger the Firebase Upload function
            
        }, 'image/jpeg', 0.7);
    }

    // --- 4. SMART TAXONOMY (GBIF API) ---
    binomialInput.addEventListener('input', (e) => {
        const query = e.target.value;
        if (query.length < 3) return;

        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            fetchSpeciesSuggestions(query);
        }, 300);
    });

    async function fetchSpeciesSuggestions(query) {
        // Search GBIF for Species
        const url = `https://api.gbif.org/v1/species/suggest?q=${query}&rank=SPECIES&datasetKey=d7dddbf4-2cf0-4f39-9b2a-bb099caae36c`;

        try {
            const response = await fetch(url);
            const data = await response.json();
            
            suggestionsList.innerHTML = ''; // Clear old

            data.forEach(item => {
                const option = document.createElement('option');
                option.value = item.scientificName; 
                suggestionsList.appendChild(option);
            });

            // Check for exact match to fill details
            const exactMatch = data.find(d => d.scientificName === query);
            if (exactMatch) fillTaxonomyDetails(exactMatch);

        } catch (error) {
            console.error("GBIF Error:", error);
        }
    }

    function fillTaxonomyDetails(data) {
        familyInput.value = data.family || "Unknown";
        genusInput.value = data.genus || "Unknown";
        authorInput.value = data.authorship || "";
        
        document.getElementById('taxa-hint').textContent = `✅ Verified: ${data.scientificName}`;
        document.getElementById('taxa-hint').classList.replace('text-muted', 'text-success');
    }
});
