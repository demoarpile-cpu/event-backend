from PIL import Image, ImageDraw
import os

input_path = '/Users/unknown1/Desktop/Event_Booking_FInal/Efrontend/public/logo/eventhubix-logo-white.png'
output_path = '/Users/unknown1/Desktop/Event_Booking_FInal/Efrontend/public/logo/eventhubix-logo-clear-v2.png'

img = Image.open(input_path).convert('RGBA')
width, height = img.size
data = img.load()

# Step 1: Create a mask for the background using flood fill from corners
mask = Image.new('L', (width, height), 0)
# Use a small tolerance for "near white" background
tolerance = 10 

def is_near_white(pixel):
    return pixel[0] > 255 - tolerance and pixel[1] > 255 - tolerance and pixel[2] > 255 - tolerance

# Flood fill from the four corners to identify background
for x, y in [(0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)]:
    if is_near_white(data[x, y]):
        ImageDraw.floodfill(mask, (x, y), 255, thresh=tolerance)

# Step 2: Apply the mask to the alpha channel
new_data = []
for y in range(height):
    for x in range(width):
        r, g, b, a = data[x, y]
        m = mask.getpixel((x, y))
        if m == 255: # Background
            new_data.append((r, g, b, 0))
        else: # Foreground (including the white star)
            new_data.append((r, g, b, 255))

img.putdata(new_data)
img.save(output_path)
print(f"Saved clear logo to {output_path}")
