from PIL import Image, ImageOps, ImageChops
import os

input_path = '/Users/unknown1/Desktop/Event_Booking_FInal/Efrontend/public/logo/eventhubix-logo-white.png'
output_path = '/Users/unknown1/Desktop/Event_Booking_FInal/Efrontend/public/logo/eventhubix-logo-clear-v3.png'

img = Image.open(input_path).convert('RGBA')
width, height = img.size

# Find bounding box
bg = Image.new('RGB', img.size, (255, 255, 255))
diff = ImageChops.difference(img.convert('RGB'), bg)
bbox = diff.getbbox()

if bbox:
    img = img.crop(bbox)
    width, height = img.size

# Expand to give room for floodfill
bordered = ImageOps.expand(img, border=4, fill=(255, 255, 255, 255))
w2, h2 = bordered.size
data = bordered.load()

# Background mask
mask = Image.new('L', (w2, h2), 255)
mask_px = mask.load()

# Simple BFS for floodfill
tolerance = 20
q = [(0, 0)]
visited = {(0, 0)}
mask_px[0, 0] = 0

while q:
    curr_x, curr_y = q.pop(0)
    for dx, dy in [(0, 1), (0, -1), (1, 0), (-1, 0)]:
        nx, ny = curr_x + dx, curr_y + dy
        if 0 <= nx < w2 and 0 <= ny < h2 and (nx, ny) not in visited:
            r, g, b, a = data[nx, ny]
            if r > 255 - tolerance and g > 255 - tolerance and b > 255 - tolerance:
                mask_px[nx, ny] = 0
                visited.add((nx, ny))
                q.append((nx, ny))

# Apply mask (with smooth edges if possible, but let's keep it simple first)
final_img = Image.new('RGBA', (w2, h2))
final_px = final_img.load()
for y in range(h2):
    for x in range(w2):
        r, g, b, a = data[x, y]
        m = mask_px[x, y]
        final_px[x, y] = (r, g, b, m)

# Crop back
final_img = final_img.crop((4, 4, w2 - 4, h2 - 4))
final_img.save(output_path)
print(f"Saved clear trimmed logo to {output_path}")
