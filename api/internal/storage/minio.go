package storage

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"net/url"
	"strings"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// Client encapsula MinIO y la URL pública usada por el navegador.
type Client struct {
	mc             *minio.Client
	bucket         string
	publicEndpoint string
}

func New(
	ctx context.Context,
	endpoint, accessKey, secretKey, bucket, publicEndpoint string,
	useSSL bool,
) (*Client, error) {
	mc, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: useSSL,
	})
	if err != nil {
		return nil, fmt.Errorf("crear cliente MinIO: %w", err)
	}

	client := &Client{
		mc:             mc,
		bucket:         bucket,
		publicEndpoint: strings.TrimRight(publicEndpoint, "/"),
	}
	if err := client.ensureBucket(ctx); err != nil {
		return nil, err
	}
	return client, nil
}

func (c *Client) ensureBucket(ctx context.Context) error {
	exists, err := c.mc.BucketExists(ctx, c.bucket)
	if err != nil {
		return fmt.Errorf("verificar bucket %q: %w", c.bucket, err)
	}
	if !exists {
		if err := c.mc.MakeBucket(ctx, c.bucket, minio.MakeBucketOptions{}); err != nil {
			return fmt.Errorf("crear bucket %q: %w", c.bucket, err)
		}
	}

	// Lectura pública SOLO para desarrollo: permite mostrar las fotos en el mapa.
	policy := fmt.Sprintf(`{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {"AWS": ["*"]},
      "Action": ["s3:GetObject"],
      "Resource": ["arn:aws:s3:::%s/*"]
    }
  ]
}`, c.bucket)
	if err := c.mc.SetBucketPolicy(ctx, c.bucket, policy); err != nil {
		log.Printf("[storage] advertencia: no se pudo aplicar política pública al bucket %q: %v", c.bucket, err)
	}
	return nil
}

// Upload sube un objeto y devuelve su URL pública.
func (c *Client) Upload(
	ctx context.Context,
	objectName string,
	data []byte,
	contentType string,
) (string, error) {
	_, err := c.mc.PutObject(
		ctx,
		c.bucket,
		objectName,
		bytes.NewReader(data),
		int64(len(data)),
		minio.PutObjectOptions{ContentType: contentType},
	)
	if err != nil {
		return "", fmt.Errorf("subir objeto %q: %w", objectName, err)
	}
	return c.PublicURL(objectName), nil
}

func (c *Client) Remove(ctx context.Context, objectName string) error {
	if err := c.mc.RemoveObject(ctx, c.bucket, objectName, minio.RemoveObjectOptions{}); err != nil {
		return fmt.Errorf("eliminar objeto %q: %w", objectName, err)
	}
	return nil
}

func (c *Client) PublicURL(objectName string) string {
	segments := strings.Split(strings.TrimLeft(objectName, "/"), "/")
	for index, segment := range segments {
		segments[index] = url.PathEscape(segment)
	}
	return c.publicEndpoint + "/" + c.bucket + "/" + strings.Join(segments, "/")
}
