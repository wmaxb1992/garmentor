"""RunPod serverless handler for TripoSR - Ultra-fast 3D generation (<0.5s on A100).

This handler provides a serverless API for image-to-3D conversion using TripoSR,
optimized for RunPod's serverless infrastructure with FlashBoot support.

Performance:
- Inference: <0.5s on A100, ~1-2s on RTX 4090
- Cold start: ~200ms with FlashBoot enabled
- Memory: ~4GB VRAM required
"""

import io
import base64
import torch
import numpy as np
from PIL import Image
import trimesh
from rembg import remove

# Global model instance (loaded once per container)
model = None
device = None


def load_model():
    """Load TripoSR model on container startup."""
    global model, device
    
    if model is not None:
        return
    
    print("Loading TripoSR model...")
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    
    # Import TripoSR
    from tsr.system import TSR
    
    # Load model with optimizations
    model = TSR.from_pretrained(
        "stabilityai/TripoSR",
        config_name="config.yaml",
        weight_name="model.ckpt",
    )
    model.to(device)
    model.eval()
    
    # Compile for faster inference on modern GPUs
    if torch.cuda.is_available():
        print("Compiling model with torch.compile...")
        model.renderer.forward = torch.compile(
            model.renderer.forward,
            mode="reduce-overhead",
            fullgraph=True
        )
    
    print("TripoSR model loaded successfully")


def preprocess_image(image_data: bytes, remove_background: bool = True) -> Image.Image:
    """Preprocess input image for TripoSR."""
    img = Image.open(io.BytesIO(image_data)).convert("RGBA")
    
    if remove_background:
        img = remove(img)
    
    # TripoSR expects square images
    size = max(img.size)
    new_img = Image.new("RGBA", (size, size), (255, 255, 255, 0))
    new_img.paste(img, ((size - img.size[0]) // 2, (size - img.size[1]) // 2))
    
    return new_img.resize((512, 512), Image.LANCZOS)


def generate_mesh(image: Image.Image, mc_resolution: int = 256) -> trimesh.Trimesh:
    """Generate 3D mesh from image using TripoSR."""
    global model, device
    
    # Convert PIL image to tensor
    image_tensor = torch.from_numpy(np.array(image)).float() / 255.0
    image_tensor = image_tensor.permute(2, 0, 1).unsqueeze(0).to(device)
    
    # Generate mesh
    with torch.no_grad():
        scene_codes = model([image_tensor], device=device)
        meshes = model.extract_mesh(scene_codes, resolution=mc_resolution)
    
    # Convert to trimesh
    mesh = meshes[0]
    vertices = mesh.vertices.cpu().numpy()
    faces = mesh.faces.cpu().numpy()
    
    return trimesh.Trimesh(vertices=vertices, faces=faces)


def handler(event):
    """
    RunPod serverless handler function.
    
    Input format:
    {
        "input": {
            "image": "base64_encoded_image_data",
            "remove_background": true,  # optional, default: true
            "mc_resolution": 256  # optional, marching cubes resolution (128-512)
        }
    }
    
    Output format:
    {
        "glb": "base64_encoded_glb_data",
        "vertices_count": 12345,
        "faces_count": 23456
    }
    """
    try:
        # Load model if not already loaded
        load_model()
        
        # Parse input
        input_data = event.get("input", {})
        image_b64 = input_data.get("image")
        remove_bg = input_data.get("remove_background", True)
        mc_resolution = input_data.get("mc_resolution", 256)
        
        if not image_b64:
            return {"error": "Missing 'image' field in input"}
        
        # Decode image
        image_data = base64.b64decode(image_b64)
        
        # Preprocess
        image = preprocess_image(image_data, remove_background=remove_bg)
        
        # Generate mesh
        mesh = generate_mesh(image, mc_resolution=mc_resolution)
        
        # Export to GLB
        glb_buffer = io.BytesIO()
        mesh.export(glb_buffer, file_type="glb")
        glb_buffer.seek(0)
        glb_b64 = base64.b64encode(glb_buffer.read()).decode("utf-8")
        
        return {
            "glb": glb_b64,
            "vertices_count": len(mesh.vertices),
            "faces_count": len(mesh.faces),
            "model": "TripoSR"
        }
        
    except Exception as e:
        return {"error": str(e)}


# For local testing
if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python triposr_handler.py <image_path>")
        sys.exit(1)
    
    with open(sys.argv[1], "rb") as f:
        image_data = f.read()
    
    image_b64 = base64.b64encode(image_data).decode("utf-8")
    
    result = handler({
        "input": {
            "image": image_b64,
            "remove_background": True
        }
    })
    
    if "error" in result:
        print(f"Error: {result['error']}")
    else:
        print(f"Success! Generated mesh with {result['vertices_count']} vertices")
        
        # Save GLB
        glb_data = base64.b64decode(result["glb"])
        with open("output.glb", "wb") as f:
            f.write(glb_data)
        print("Saved to output.glb")
