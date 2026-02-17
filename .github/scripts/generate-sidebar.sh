#!/usr/bin/env bash

# Generate Sidebar Script
# Creates _Sidebar.md for GitHub Wiki navigation

set -euo pipefail
shopt -s nullglob  # Allow glob patterns to expand to empty list if no matches

# Configuration
SOURCE_DIR="${SOURCE_DIR:-docs/wiki}"  # Read structure from source
WIKI_DIR="${WIKI_DIR:-wiki}"           # Write sidebar to wiki
SIDEBAR_FILE="$WIKI_DIR/_Sidebar.md"

echo "📋 Generating sidebar navigation..."
echo "==================================="
echo "Wiki directory: $WIKI_DIR"
echo "Output file: $SIDEBAR_FILE"
echo ""

# Check if directories exist
if [ ! -d "$SOURCE_DIR" ]; then
    echo "❌ Error: Source directory $SOURCE_DIR does not exist"
    exit 1
fi
if [ ! -d "$WIKI_DIR" ]; then
    echo "❌ Error: Wiki directory $WIKI_DIR does not exist"
    exit 1
fi

# Function to get clean page title from filename
get_page_title() {
    local filename="$1"
    local basename
    basename=$(basename "$filename" .md)

    # Convert filename to title
    echo "$basename" | sed -E 's/-/ /g' | sed -E 's/\b(\w)/\u\1/g'
}

# Main execution
main() {
    # Start fresh
    cat > "$SIDEBAR_FILE" << 'EOF'
# Navigation

- [🏠 Home](Home)

---

## Documentation

EOF

    # Process root level files (except Home which is already added)
    for file in "$SOURCE_DIR"/*.md; do
        if [ ! -f "$file" ]; then
            continue
        fi

        local basename
        basename=$(basename "$file" .md)

        # Skip special files and already added files
        if [[ "$basename" =~ ^_(Footer|Sidebar)$ ]] || \
           [[ "$basename" == "Home" ]]; then
            continue
        fi

        local title
        title=$(get_page_title "$file")

        # Determine emoji based on page name
        local emoji=""
        case "$basename" in
            Astro-Implementation) emoji="🏗️ " ;;
            Brand-Guide) emoji="🎨 " ;;
            Why-Astro) emoji="📊 " ;;
            *) emoji="" ;;
        esac

        echo "- [${emoji}${title}]($basename)" >> "$SIDEBAR_FILE"
    done

    # Add footer section
    cat >> "$SIDEBAR_FILE" << 'EOF'

---

## Resources

- [📚 Main Repository](https://github.com/j0nathan-ll0yd/j0nathan-ll0yd.github.io)
- [🐛 Report Issue](https://github.com/j0nathan-ll0yd/j0nathan-ll0yd.github.io/issues)
EOF

    echo "✅ Sidebar generated successfully!"
    echo ""
    echo "📊 Sidebar statistics:"
    echo "  - Lines: $(wc -l < "$SIDEBAR_FILE")"
    echo "  - Links: $(grep -c '\[.*\](' "$SIDEBAR_FILE" || echo 0)"

    # Show preview
    echo ""
    echo "📄 Sidebar preview:"
    echo "-----------------------------------"
    cat "$SIDEBAR_FILE"
}

# Run main function
main
