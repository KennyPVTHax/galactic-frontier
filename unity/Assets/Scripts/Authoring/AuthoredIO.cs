using System.IO;
using System.IO.Compression;

namespace GF.Authoring
{
    /// <summary>Compressed file format for authored worlds: GZip around the versioned binary payload (typically 5-10x smaller).</summary>
    public static class AuthoredIO
    {
        public static void Write(AuthoredWorld w, Stream s)
        {
            using (var gz = new GZipStream(s, System.IO.Compression.CompressionLevel.Optimal, true)) w.Write(gz);
        }

        public static AuthoredWorld Read(Stream s)
        {
            using (var gz = new GZipStream(s, CompressionMode.Decompress, true)) return AuthoredWorld.Read(gz);
        }
    }
}
